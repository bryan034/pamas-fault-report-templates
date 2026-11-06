# Report Formatter

## Overview

A document automation application that turns PDF and Word files into reusable templates, with photo-assisted data entry, saved drafts and report exports. It has a web deployment and an offline Windows desktop edition that needs no Docker, account or internet connection.

## My contribution

Led product design, workflow requirements and implementation review using AI-assisted development.

- Shaped a visual template editor with draggable fields, background covers, accurate font sizing and undo/redo.
- Developed the reporting workflow around inline editing, photographs, calculations, annotations and a choice of PDF or Word downloads for blank templates and completed reports.
- Defined whole-photo OCR behavior to extract temperature readings and match them to nearby fields.
- Specified revision-safe drafts, persistent storage and role-based company access for the web deployment.
- Defined an offline Windows edition for non-technical users, with a desktop icon, preloaded templates, Word upload and backup and restore to a USB drive or cloud-synced folder.

## Technologies

**Frontend**  
React · TypeScript · Vinext · Vite

**Desktop**  
Electron · electron-builder (NSIS installer)

**Backend**  
Python · FastAPI · Pydantic

**Database**  
PostgreSQL (web) · SQLite (desktop) · SQLAlchemy · Alembic

**Document processing**  
PDF.js · ReportLab · pdfplumber · python-docx · ONLYOFFICE (web) · LibreOffice (desktop)

**OCR**  
Tesseract.js

**Infrastructure**  
Docker · Cloudflare Workers/Containers · Supabase

**Authentication**  
Google OAuth/OIDC (web)

**Testing**  
Playwright · pytest · Node.js tests

## Skills demonstrated

**Product design:** Turned reporting needs into practical editing workflows.

**Full-stack understanding:** Connected document interfaces, APIs, OCR and database storage, then adapted them to run on one computer without hosted services.

**Problem solving:** Addressed field placement, variable photo layouts and document revision safety.

**Delivery:** Refined features through feedback and automated checks; prepared staging and production configurations and delivered a one-click Windows installer.
