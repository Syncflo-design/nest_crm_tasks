# Nest CRM Tasks — Lead Activity Hub

A reusable Frappe v16 custom app for NestERP clients. Adds a richer "Lead Activity Hub" desk page and intercepts ToDo list row clicks so that ToDos linked to a Lead open the hub instead of the default ToDo form.

## What you get

- A **Lead Activity Hub** desk page at `/app/lead-activity/<lead_name>`.
- Header card: lead name + status badge, company / territory / industry, contact details, owner, source.
- Activity table: every ToDo linked to the lead — description, due date, assignee, priority, status, action.
- **Mark Complete** per open task row (in-place status → Closed).
- **Add Task** dialog to create a new ToDo against the lead.
- **View Full Profile** action that opens the standard Lead form.
- **Back to My Tasks** action that returns to the ToDo list.

Non-Lead ToDos are unaffected — default Frappe navigation is preserved.

## Install

```bash
bench get-app https://github.com/Syncflo-design/nest_crm_tasks
bench --site <your-site> install-app nest_crm_tasks
bench --site <your-site> migrate
```

## Compatibility

Targets Frappe v16. The packaging (PEP 621 `pyproject.toml`, no `setup.py`) is v16-required.

## License

MIT
