from pathlib import Path

from app.models import ReportData
from app.pdf_service import generate_report_pdf


BACKEND = Path(__file__).resolve().parents[1]
PROJECT = BACKEND.parent
OUTPUT = PROJECT / "output" / "pdf" / "fault-report-generator-sample.pdf"


def main() -> None:
    fixtures = BACKEND / "tests" / "fixtures"
    equipment = (fixtures / "sample_equipment.png").read_bytes()
    infrared = (fixtures / "sample_ir.png").read_bytes()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    report = ReportData(
        report_title="Contactor thermal fault", report_number="1", company="STMicroelectronics", division="AMK 6E",
        report_date="2025-12-16", report_time="17:02", period="P.M.",
        repair_priority="shutdown", emissivity=0.85, bx1=66.1, bx2=53.0,
        ambient_temp=22, phase="L2", rated_current="100", l1_current="51",
        l2_current="51", l3_current="49", neutral_current="-", l1_load="-%",
        l2_load="-%", l3_load="-%", neutral_load="-", location_line_1="Level 5",
        description=("6E-EHF-19-301 (100A).\n'C1' Contactor (Telemecanique LC1 D95),\n"
                     "poor contact at the bottom L2 phase cable / internal terminations."),
        corrective_action=("Remove all the incoming & outgoing L1, L2 & L3 phase terminations "
                           "from the contactor. Trim the cables and replace the cable lugs. "
                           "Clean the contactor terminals. Re-terminate the cables back to the "
                           "contactor and tighten."),
        readings_confirmed=True,
    )
    OUTPUT.write_bytes(generate_report_pdf(report, equipment, infrared))
    print(OUTPUT)


if __name__ == "__main__":
    main()
