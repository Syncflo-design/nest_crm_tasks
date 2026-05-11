// nest_crm_tasks — My Activities
// Custom replacement for /desk/todo. We control the rendering, so click handling works.
// Each Lead-linked row has a clickable Lead badge that opens /app/lead-activity/<lead>.

frappe.pages['my-activities'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'My Activities',
		single_column: true
	});

	wrapper.my_activities = new MyActivities(page, wrapper);
};

frappe.pages['my-activities'].on_page_show = function(wrapper) {
	if (wrapper.my_activities) {
		wrapper.my_activities.refresh();
	}
};

// ---------------------------------------------------------------------------

class MyActivities {

	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;

		// v16 modern desk: page.body is a jQuery object (NOT a DOM element). Create our
		// own container inside it — `$(wrapper).find('.my-activities-page')` returns an
		// empty collection because nothing creates that div. See
		// gotchas/2026-05-10-frappe-v16-page-api-drift.md.
		this.$main = $('<div class="my-activities-page"></div>').appendTo(page.body);

		// Persist filter choices across sessions
		this.scope  = localStorage.getItem('nest.my_activities.scope')  || 'mine';   // 'mine' | 'all'
		this.status = localStorage.getItem('nest.my_activities.status') || 'open';   // 'open' | 'closed' | 'any'

		this.setup_page_actions();
		this.bind_events();
		this.refresh();
	}

	setup_page_actions() {
		var me = this;

		this.page.set_primary_action('Add Task', function() {
			me.open_new_task_dialog();
		}, 'octicon octicon-plus');

		// Scope toggle (My Tasks / All)
		this.page.add_field({
			fieldtype: 'Select', fieldname: 'scope', label: 'Scope', default: this.scope,
			options: [
				{ label: 'My tasks',  value: 'mine' },
				{ label: 'All tasks', value: 'all' }
			],
			change: function() {
				me.scope = this.value;
				localStorage.setItem('nest.my_activities.scope', me.scope);
				me.refresh();
			}
		});

		// Status filter
		this.page.add_field({
			fieldtype: 'Select', fieldname: 'status', label: 'Status', default: this.status,
			options: [
				{ label: 'Open',   value: 'open' },
				{ label: 'Closed', value: 'closed' },
				{ label: 'Any',    value: 'any' }
			],
			change: function() {
				me.status = this.value;
				localStorage.setItem('nest.my_activities.status', me.status);
				me.refresh();
			}
		});

		this.page.add_action_item('Standard ToDo List', function() {
			frappe.set_route('List', 'ToDo');
		});

		this.page.add_action_item('Refresh', function() {
			me.refresh();
		});
	}

	bind_events() {
		var me = this;

		// Lead badge click → Lead Activity Hub. Stop propagation so the row click doesn't also fire.
		this.$main.on('click', '.nest-lead-badge', function(e) {
			e.preventDefault();
			e.stopPropagation();
			var lead = $(this).data('lead');
			if (lead) frappe.set_route('lead-activity', lead);
		});

		// Row click (anywhere except badge / Mark Complete) → open the standard ToDo form
		this.$main.on('click', '.nest-task-row', function(e) {
			if ($(e.target).closest('.nest-lead-badge, .nest-complete-btn, .nest-reopen-btn, button, a').length) return;
			var name = $(this).data('todo');
			if (name) frappe.set_route('Form', 'ToDo', name);
		});

		this.$main.on('click', '.nest-complete-btn', function(e) {
			e.stopPropagation();
			me.set_status($(this).data('todo'), 'Closed', $(this));
		});

		this.$main.on('click', '.nest-reopen-btn', function(e) {
			e.stopPropagation();
			me.set_status($(this).data('todo'), 'Open', $(this));
		});
	}

	// ---------------------------------------------------------------------

	refresh() {
		var me = this;
		this.$main.html('<div class="text-muted text-center" style="padding:40px;">Loading…</div>');

		this.fetch_tasks().then(function(tasks) {
			me.render(tasks);
		}).catch(function(err) {
			me.$main.html(
				'<div class="alert alert-danger" style="margin:20px;">'
				+ 'Could not load activities. '
				+ ((err && err.message) ? frappe.utils.escape_html(err.message) : '')
				+ '</div>'
			);
		});
	}

	fetch_tasks() {
		var filters = [];
		if (this.scope === 'mine') {
			filters.push(['allocated_to', '=', frappe.session.user]);
		}
		if (this.status === 'open')   filters.push(['status', '=', 'Open']);
		if (this.status === 'closed') filters.push(['status', '=', 'Closed']);

		return frappe.db.get_list('ToDo', {
			filters: filters,
			fields: [
				'name', 'description', 'date',
				'allocated_to', 'assigned_by', 'owner',
				'priority', 'status', 'modified',
				'reference_type', 'reference_name'
			],
			order_by: 'date asc, modified desc',
			limit: 200
		});
	}

	// ---------------------------------------------------------------------

	render(tasks) {
		var esc = frappe.utils.escape_html;

		var priority_color = { 'High': 'red', 'Medium': 'yellow', 'Low': 'grey' };
		var status_color   = { 'Open': 'blue', 'Closed': 'green', 'Cancelled': 'grey' };

		var open_count   = tasks.filter(function(t) { return t.status === 'Open'; }).length;
		var lead_count   = tasks.filter(function(t) { return t.reference_type === 'Lead'; }).length;
		var total = tasks.length;

		var summary = '<div style="display:flex;gap:24px;margin-bottom:16px;padding:12px 16px;'
			+ 'background:var(--card-bg, #fff);border:1px solid var(--border-color, #d1d8dd);'
			+ 'border-radius:4px;font-size:13px;">'
			+ '<div><strong>' + total + '</strong> tasks</div>'
			+ '<div><strong>' + open_count + '</strong> open</div>'
			+ '<div><strong>' + lead_count + '</strong> linked to leads</div>'
			+ '</div>';

		this.$main.html(summary);

		if (!total) {
			this.$main.append(
				'<div class="text-muted text-center" style="padding:60px;">'
				+ '<p>No activities match the current filter.</p>'
				+ '</div>'
			);
			return;
		}

		// Priority sort within same date
		var rank = { High: 0, Medium: 1, Low: 2 };
		tasks.sort(function(a, b) {
			var ad = a.date || '9999-12-31';
			var bd = b.date || '9999-12-31';
			if (ad !== bd) return ad < bd ? -1 : 1;
			return (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99);
		});

		var badge_style = 'background:#1B5EA0;color:#fff;padding:2px 8px;font-size:11px;'
			+ 'font-weight:500;text-decoration:none;border-radius:3px;display:inline-block;'
			+ 'vertical-align:middle;line-height:1.5;cursor:pointer;';

		var rows = tasks.map(function(t) {
			var safe_name = esc(t.name);

			// Description (strip HTML, truncate)
			// frappe.utils.strip_html doesn't exist in v16 — use jQuery to extract text
			var plain = t.description ? $('<div>').html(t.description).text() : '';
			var desc = plain
				? esc(plain.substring(0, 140)) + (plain.length > 140 ? '…' : '')
				: '<em class="text-muted">No description</em>';

			// Lead badge (or just the reference type for non-Lead refs)
			var lead_cell = '';
			if (t.reference_type === 'Lead' && t.reference_name) {
				lead_cell = '<a class="nest-lead-badge" data-lead="' + esc(t.reference_name) + '"'
					+ ' href="/app/lead-activity/' + encodeURIComponent(t.reference_name) + '"'
					+ ' title="Open Lead Activity Hub for ' + esc(t.reference_name) + '"'
					+ ' style="' + badge_style + '">'
					+ '<i class="fa fa-user" style="margin-right:4px;"></i>'
					+ esc(t.reference_name)
					+ '</a>';
			} else if (t.reference_type && t.reference_name) {
				lead_cell = '<span class="text-muted" style="font-size:12px;">'
					+ esc(t.reference_type) + ': ' + esc(t.reference_name)
					+ '</span>';
			} else {
				lead_cell = '<span class="text-muted">—</span>';
			}

			var date_str = t.date ? esc(frappe.datetime.str_to_user(t.date)) : '<span class="text-muted">—</span>';
			var assigned_to = t.allocated_to || t.owner || '—';

			var priority_badge = t.priority
				? '<span class="indicator-pill ' + (priority_color[t.priority] || 'grey') + '">'
					+ esc(t.priority) + '</span>'
				: '—';

			var status_badge = '<span class="indicator-pill ' + (status_color[t.status] || 'grey') + '">'
				+ esc(t.status || 'Open') + '</span>';

			// Icon-only action buttons with tooltips — saves horizontal space.
			var action_btn = '';
			if (t.status === 'Open') {
				action_btn = '<button class="btn btn-xs btn-success nest-complete-btn" data-todo="'
					+ safe_name + '" title="Mark as Complete" aria-label="Mark as Complete">'
					+ '<i class="fa fa-check"></i></button>';
			} else if (t.status === 'Closed') {
				action_btn = '<button class="btn btn-xs btn-default nest-reopen-btn" data-todo="'
					+ safe_name + '" title="Reopen" aria-label="Reopen">'
					+ '<i class="fa fa-undo"></i></button>';
			}

			return '<tr class="nest-task-row" data-todo="' + safe_name + '" style="cursor:pointer;">'
				+ '<td>' + desc + '</td>'
				+ '<td>' + lead_cell + '</td>'
				+ '<td style="white-space:nowrap;">' + date_str + '</td>'
				+ '<td>' + esc(assigned_to) + '</td>'
				+ '<td>' + priority_badge + '</td>'
				+ '<td>' + status_badge + '</td>'
				+ '<td style="white-space:nowrap;">' + action_btn + '</td>'
				+ '</tr>';
		}).join('');

		var table = '<div style="overflow-x:auto;">'
			+ '<table class="table table-bordered table-hover" style="font-size:13px;margin-bottom:0;background:var(--card-bg, #fff);">'
			+ '<thead style="background:var(--bg-light, #f4f7fa);">'
			+ '<tr>'
			+ '<th style="min-width:280px;">Description</th>'
			+ '<th style="width:200px;">Lead / Reference</th>'
			+ '<th style="width:110px;">Due Date</th>'
			+ '<th style="width:170px;">Assigned To</th>'
			+ '<th style="width:90px;">Priority</th>'
			+ '<th style="width:90px;">Status</th>'
			+ '<th style="width:60px;text-align:center;">Action</th>'
			+ '</tr>'
			+ '</thead>'
			+ '<tbody>' + rows + '</tbody>'
			+ '</table>'
			+ '</div>';

		this.$main.append(table);
	}

	// ---------------------------------------------------------------------

	set_status(todo_name, new_status, $btn) {
		var me = this;
		var prev_label = $btn.text();
		$btn.prop('disabled', true).text('Saving…');

		frappe.db.set_value('ToDo', todo_name, 'status', new_status)
			.then(function() {
				frappe.show_alert({
					message: new_status === 'Closed' ? 'Task marked complete' : 'Task reopened',
					indicator: new_status === 'Closed' ? 'green' : 'blue'
				});
				me.refresh();
			})
			.catch(function() {
				frappe.show_alert({ message: 'Could not update task', indicator: 'red' });
				$btn.prop('disabled', false).text(prev_label);
			});
	}

	open_new_task_dialog() {
		var me = this;

		var d = new frappe.ui.Dialog({
			title: 'Add Task',
			fields: [
				{ fieldname: 'description', fieldtype: 'Small Text', label: 'Description', reqd: 1 },
				{ fieldname: 'date',        fieldtype: 'Date',       label: 'Due Date',    default: frappe.datetime.nowdate() },
				{ fieldname: 'priority',    fieldtype: 'Select',     label: 'Priority',
				  options: 'Low\nMedium\nHigh', default: 'Medium' },
				{ fieldname: 'allocated_to', fieldtype: 'Link',      label: 'Assign To',
				  options: 'User', default: frappe.session.user },
				{ fieldname: 'reference_type', fieldtype: 'Link',    label: 'Link To (Doctype)',
				  options: 'DocType' },
				{ fieldname: 'reference_name', fieldtype: 'Dynamic Link', label: 'Linked Document',
				  options: 'reference_type' }
			],
			primary_action_label: 'Add Task',
			primary_action: function(values) {
				d.disable_primary_action();

				frappe.db.insert({
					doctype: 'ToDo',
					description: values.description,
					date: values.date || null,
					priority: values.priority,
					allocated_to: values.allocated_to || frappe.session.user,
					reference_type: values.reference_type || null,
					reference_name: values.reference_name || null,
					assigned_by: frappe.session.user,
					status: 'Open'
				}).then(function() {
					frappe.show_alert({ message: 'Task added', indicator: 'green' });
					d.hide();
					me.refresh();
				}).catch(function() {
					d.enable_primary_action();
					frappe.show_alert({ message: 'Could not add task', indicator: 'red' });
				});
			}
		});

		d.show();
	}
}
