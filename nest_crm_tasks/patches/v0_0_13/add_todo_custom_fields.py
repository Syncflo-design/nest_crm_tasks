"""Add custom fields to ToDo for Nest CRM task tracking.

- task_type   (Link to Task Type)       — categorises each ToDo as Phone /
                                          Email / Site Visit / etc.
- parent_task (Link to ToDo, read-only) — the predecessor when this task
                                          was created as a follow-up by
                                          a Task Outcome record. Lets the
                                          Lead Activity Hub render the
                                          "Phone -> Email -> Site visit"
                                          chain per lead.

Runs in [post_model_sync] so Task Type exists before Custom Field
creation references it as the Link options.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	custom_fields = {
		"ToDo": [
			{
				"fieldname": "task_type",
				"label": "Task Type",
				"fieldtype": "Link",
				"options": "Task Type",
				"insert_after": "description",
			},
			{
				"fieldname": "parent_task",
				"label": "Parent Task",
				"fieldtype": "Link",
				"options": "ToDo",
				"insert_after": "task_type",
				"read_only": 1,
				"description": (
					"Set automatically when this task was created as a "
					"follow-up to another via a Task Outcome record."
				),
			},
		]
	}
	create_custom_fields(custom_fields, ignore_validate=True)
