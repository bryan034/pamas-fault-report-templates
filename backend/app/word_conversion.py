"""Bounded, local DOCX conversion; never send documents to a cloud converter."""

from io import BytesIO
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from zipfile import BadZipFile, ZipFile

from lxml import etree

MAX_UPLOAD = 20 * 1024 * 1024
MAX_EXPANDED = 100 * 1024 * 1024
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_conversion_slot = threading.BoundedSemaphore(1)


class ConverterUnavailable(ValueError):
    pass


def validate_docx(payload: bytes) -> None:
    """Check OOXML before LibreOffice: no ZIP bombs, macros or external fetches."""
    if len(payload) > MAX_UPLOAD:
        raise ValueError("Word document exceeds the 20 MB limit")
    try:
        with ZipFile(BytesIO(payload)) as archive:
            entries = archive.infolist()
            names = {entry.filename for entry in entries}
            if (
                len(entries) > 2000
                or sum(entry.file_size for entry in entries) > MAX_EXPANDED
            ):
                raise ValueError("Word document expands beyond the processing limit")
            if not {"[Content_Types].xml", "word/document.xml"} <= names:
                raise ValueError("Upload a valid Word .docx document")
            if len(names) != len(entries) or any(
                entry.flag_bits & 1 for entry in entries
            ):
                raise ValueError(
                    "Encrypted or ambiguous Word archives are not supported"
                )
            parser = etree.XMLParser(
                resolve_entities=False, no_network=True, load_dtd=False
            )
            for entry in entries:
                name = entry.filename.lower()
                if (
                    "vbaproject" in name
                    or name.startswith("word/embeddings/")
                    or "activex" in name
                ):
                    raise ValueError(
                        "Macros, embedded objects and ActiveX are not supported"
                    )
                if name.endswith((".xml", ".rels")):
                    raw = archive.read(entry)
                    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                        raise ValueError(
                            "Word documents with XML entities are not supported"
                        )
                    root = etree.fromstring(raw, parser)
                    if root.getroottree().docinfo.doctype:
                        raise ValueError(
                            "Word documents with XML entities are not supported"
                        )
                    if name == "[content_types].xml":
                        if any(
                            "macroenabled" in item.get("ContentType", "").lower()
                            for item in root
                        ):
                            raise ValueError(
                                "Macro-enabled documents are not supported"
                            )
                    if name.endswith(".rels"):
                        for relation in root:
                            if relation.get(
                                "TargetMode", ""
                            ).lower() == "external" and not relation.get(
                                "Type", ""
                            ).endswith("/hyperlink"):
                                raise ValueError(
                                    "Embed linked images/resources before uploading this Word document"
                                )
                    if name.startswith("word/"):
                        if root.xpath("//*[local-name()='altChunk']"):
                            raise ValueError(
                                "Convert embedded HTML/imported content to normal Word content before uploading"
                            )
                        instructions = " ".join(
                            root.xpath("//*[local-name()='instrText']/text()")
                        )
                        if any(
                            token in instructions.upper()
                            for token in (
                                "INCLUDEPICTURE",
                                "INCLUDETEXT",
                                "DDEAUTO",
                                "DDE ",
                            )
                        ):
                            raise ValueError("External Word fields are not supported")
    except (
        BadZipFile,
        etree.XMLSyntaxError,
        RuntimeError,
        NotImplementedError,
    ) as error:
        raise ValueError(
            "The uploaded file could not be read as a Word .docx document"
        ) from error


def docx_to_pdf(payload: bytes) -> bytes:
    validate_docx(payload)
    executable = (
        os.environ.get("LIBREOFFICE_BINARY")
        or shutil.which("soffice")
        or shutil.which("libreoffice")
    )
    if not executable:
        raise ConverterUnavailable(
            "Word conversion is unavailable. Rebuild the template-service Docker image (includes LibreOffice Writer)."
        )
    if not _conversion_slot.acquire(timeout=15):
        raise ValueError("Word converter is busy. Try again shortly.")
    try:
        with tempfile.TemporaryDirectory(prefix="report-word-") as directory:
            work = Path(directory)
            source = work / "source.docx"
            source.write_bytes(payload)
            profile = work / "profile"
            profile.mkdir()
            # Never use the desktop user's profile, execute macros or update links.
            (profile / "user").mkdir()
            (profile / "user/registrymodifications.xcu").write_text(
                '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry">'
                '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
                '<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>',
                encoding="utf-8",
            )
            try:
                result = subprocess.run(
                    [
                        executable,
                        f"-env:UserInstallation={profile.as_uri()}",
                        "--headless",
                        "--nologo",
                        "--nodefault",
                        "--norestore",
                        "--convert-to",
                        "pdf:writer_pdf_Export",
                        "--outdir",
                        str(work),
                        str(source),
                    ],
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    timeout=60,
                    check=False,
                )
            except subprocess.TimeoutExpired as error:
                raise ValueError(
                    "Word conversion timed out. Simplify the document and try again."
                ) from error
            except OSError as error:
                raise ConverterUnavailable(
                    "Word converter could not start. Check the service image and LIBREOFFICE_BINARY setting."
                ) from error
            target = work / "source.pdf"
            if (
                result.returncode
                or not target.is_file()
                or target.stat().st_size > MAX_EXPANDED
            ):
                raise ValueError(
                    "Word conversion failed. Check the document opens correctly and is not password-protected."
                )
            pdf = target.read_bytes()
            if not pdf.startswith(b"%PDF-"):
                raise ValueError("Word converter did not produce a valid PDF")
            # Validate the same page-count/geometry limits as uploaded PDFs.
            from .template_pdf import inspect_pdf

            inspect_pdf(pdf)
            return pdf
    finally:
        _conversion_slot.release()
