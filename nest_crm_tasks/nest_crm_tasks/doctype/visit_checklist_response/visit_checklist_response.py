import frappe
from frappe.model.document import Document


class VisitChecklistResponse(Document):
	def before_save(self):
		"""On first save (no answers yet), seed the answer rows from the
		selected template's questions so the rep just fills in values.
		Re-runs are no-ops because we check answers list emptiness.
		"""
		if not self.answers and self.template:
			self._seed_answers_from_template()

	def _seed_answers_from_template(self):
		template = frappe.get_doc("Visit Checklist Template", self.template)
		ordered = sorted(
			template.questions,
			key=lambda r: (r.sort_order or 0, r.idx or 0),
		)
		for q in ordered:
			self.append("answers", {
				"question": q.name,
				"question_text": q.question_text,
				"response_type": q.response_type,
			})
