# SME Bug Report Template

Use this template to report issues. Clear, complete reports help us fix problems quickly.

## Summary
- One-line description of the problem
- Severity: Blocker | Major | Minor

## What You Tried to Do
- Short description of the task you were performing

## Steps to Reproduce
1. Project: <project name or ID>
2. Task: include URL (e.g., https://label.boathou.se/projects/<id>/data?task=<task_id>)
3. Action(s): e.g., opened task, clicked Get predictions, drew a box, saved
4. Data type: Text | PDF | CSV | XLSX (include sample if possible)
5. For PDFs: include `pdf_url` or attach a redacted copy if allowed

## Expected Result
- What you expected to see happen

## Actual Result
- What you actually saw (UI behavior, error messages)

## Screenshots / Screen Recording
- Drag-and-drop images or link to a recording

## Environment
- Browser + version (e.g., Chrome 128)
- OS (e.g., Windows 11, macOS 14)
- Timestamp + timezone when it occurred

## Identifiers to Help Us Debug
- Project ID: (Settings → Project → URL shows /projects/<id>)
- Task ID: (from the task URL or export)
- Annotation ID (if visible)
- For boxes on PDFs: page number and label (e.g., page=3, label=TABLE)

## Extras (Optional)
- Did predictions appear? (Yes/No)
- Is auto-annotation enabled? (Yes/No)
- Any network errors in DevTools (Console/Network tab)? If yes, paste the status code/body if safe.

## Contact
- Name and team/channel for follow-up

---
Tips:
- Redact sensitive content. If a sample is required, create a minimal repro using public or dummy data.
- Include the exact time of failure; we can correlate with server logs.
