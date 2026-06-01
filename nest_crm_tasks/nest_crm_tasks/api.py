"""nest_crm_tasks public API — whitelisted endpoints for the page JS."""

import frappe


@frappe.whitelist()
def get_crm_tasks_settings():
    """Return the settings the page JS needs. Always truthy.
    Reads the Single doc with ignore_permissions so non-admin users
    (who can't read the Settings form) still get the config."""
    try:
        doc = frappe.get_cached_doc("CRM Tasks Settings")
        return {
            "require_followup_on_complete": bool(doc.require_followup_on_complete),
        }
    except Exception:
        # First run before the doc is created — return defaults.
        return {
            "require_followup_on_complete": True,
        }
