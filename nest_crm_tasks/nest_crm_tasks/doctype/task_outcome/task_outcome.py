import frappe
from frappe.model.document import Document


class TaskOutcome(Document):
	def after_insert(self):
		self._close_source_todo()
		self._maybe_create_next_task()

	def on_update(self):
		# Handle case where someone ticks needs_followup after the initial
		# save and saves again. Idempotent — _maybe_create_next_task checks
		# next_task already set.
		if self.needs_followup and not self.next_task:
			self._maybe_create_next_task()

	def _close_source_todo(self):
		"""Mark the source ToDo Closed so completed tasks fall off the open list."""
		try:
			source = frappe.get_doc("ToDo", self.todo)
		except frappe.DoesNotExistError:
			return
		if source.status != "Closed":
			source.status = "Closed"
			source.save(ignore_permissions=True)

	def _maybe_create_next_task(self):
		if not self.needs_followup or self.next_task:
			return
		if not self.next_task_date or not self.next_task_type:
			return

		try:
			source = frappe.get_doc("ToDo", self.todo)
		except frappe.DoesNotExistError:
			return

		ref_label = source.reference_name or source.name
		new = frappe.new_doc("ToDo")
		new.description = f"{self.next_task_type} — follow-up of {ref_label}"
		new.allocated_to = source.allocated_to
		new.reference_type = source.reference_type
		new.reference_name = source.reference_name
		new.date = self.next_task_date
		new.status = "Open"
		new.priority = source.priority or "Medium"
		# Custom fields added by patch v0_0_13.add_todo_custom_fields.
		new.task_type = self.next_task_type
		new.parent_task = self.todo
		new.insert(ignore_permissions=True)

		self.db_set("next_task", new.name)
