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
		this.scope       = localStorage.getItem('nest.my_activities.scope')       || 'mine';   // 'mine' | 'all'
		this.status      = localStorage.getItem('nest.my_activities.status')      || 'open';   // 'open' | 'closed' | 'any'
		this.assigned_to = localStorage.getItem('nest.my_activities.assigned_to') || '';       // '' | <user>
		this.due_before  = localStorage.getItem('nest.my_activities.due_before')  || '';       // '' | YYYY-MM-DD

		this.setup_page_actions();
		this.bind_events();
		this.refresh();
	}

	setup_page_actions() {
		var me = this;

		this.page.set_primary_action('<i class="fa fa-plus" style="margin-right:6px;"></i>Add Task', function() {
			me.open_new_task_dialog();
		});

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

		// Assigned To filter — User picker. When set, overrides the scope (mine/all)
		// because the user has been explicit about whose tasks they want.
		this.page.add_field({
			fieldtype: 'Link', fieldname: 'assigned_to', label: 'Assigned To',
			options: 'User', default: this.assigned_to,
			change: function() {
				me.assigned_to = this.value || '';
				localStorage.setItem('nest.my_activities.assigned_to', me.assigned_to);
				me.refresh();
			}
		});

		// Due On/Before filter — Date picker. Applies as date <= chosen, so it shows
		// overdue tasks + tasks due today + tasks due before that date. The default
		// "no filter" state shows everything regardless of due date.
		this.page.add_field({
			fieldtype: 'Date', fieldname: 'due_before', label: 'Due On/Before',
			default: this.due_before,
			change: function() {
				me.due_before = this.value || '';
				localStorage.setItem('nest.my_activities.due_before', me.due_before);
				me.refresh();
			}
		});

		this.page.add_action_item('Clear filters', function() {
			me.scope = 'all';
			me.status = 'any';
			me.assigned_to = '';
			me.due_before = '';
			localStorage.setItem('nest.my_activities.scope',       me.scope);
			localStorage.setItem('nest.my_activities.status',      me.status);
			localStorage.setItem('nest.my_activities.assigned_to', me.assigned_to);
			localStorage.setItem('nest.my_activities.due_before',  me.due_before);
			// Re-sync the page header field values
			me.page.fields_dict.scope       && me.page.fields_dict.scope.set_value('all');
			me.page.fields_dict.status      && me.page.fields_dict.status.set_value('any');
			me.page.fields_dict.assigned_to && me.page.fields_dict.assigned_to.set_value('');
			me.page.fields_dict.due_before  && me.page.fields_dict.due_before.set_value('');
			me.refresh();
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
			var $btn = $(this);
			var todo_name = $btn.data('todo');
			// Confirm before closing — prevents accidental clicks on the icon-only button.
			frappe.confirm(
				'Mark this task as complete?',
				function() { me.set_status(todo_name, 'Closed', $btn); }
			);
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

		// Explicit "Assigned To" filter takes precedence over the scope toggle.
		if (this.assigned_to) {
			filters.push(['allocated_to', '=', this.assigned_to]);
		} else if (this.scope === 'mine') {
			filters.push(['allocated_to', '=', frappe.session.user]);
		}

		if (this.status === 'open')   filters.push(['status', '=', 'Open']);
		if (this.status === 'closed') filters.push(['status', '=', 'Closed']);

		// Due-date cap: show every task with date <= chosen (so overdue + due-today
		// + due-before-cap all appear). No cap = show everything.
		if (this.due_before) {
			filters.push(['date', '<=', this.due_before]);
		}

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
		}).then(this.enrich_reference_names.bind(this));
	}

	// Resolve reference_name → display name for Lead and Customer references in
	// a single batched call per doctype. CRM-LEAD-XXX codes are useless to a rep;
	// they want to see "Marius" or "Lind SA Automation" at a glance.
	enrich_reference_names(tasks) {
		var by_type = {};
		tasks.forEach(function(t) {
			if (t.reference_type && t.reference_name) {
				(by_type[t.reference_type] = by_type[t.reference_type] || []).push(t.reference_name);
			}
		});

		// Doctypes we know how to enrich + which fields to fetch.
		var enrichers = {
			'Lead':     ['lead_name', 'company_name'],
			'Customer': ['customer_name'],
			'Opportunity': ['party_name', 'customer_name'],
			'HD Ticket': ['subject']
		};

		var promises = [];
		var lookups = {};   // { 'Lead': { 'CRM-LEAD-X': {lead_name, company_name} }, ... }

		Object.keys(enrichers).forEach(function(dt) {
			var refs = by_type[dt];
			if (!refs || refs.length === 0) return;
			var unique = Array.from(new Set(refs));
			promises.push(
				frappe.db.get_list(dt, {
					filters: [['name', 'in', unique]],
					fields: ['name'].concat(enrichers[dt]),
					limit: 500
				}).then(function(rows) {
					lookups[dt] = {};
					rows.forEach(function(r) { lookups[dt][r.name] = r; });
				}).catch(function() {
					// User may not have read perm on this doctype — silently skip.
					lookups[dt] = {};
				})
			);
		});

		return Promise.all(promises).then(function() {
			tasks.forEach(function(t) {
				var look = lookups[t.reference_type];
				if (!look) return;
				var row = look[t.reference_name];
				if (!row) return;
				if (t.reference_type === 'Lead') {
					// Prefer person name, append company in parens if both exist.
					var name    = row.lead_name || '';
					var company = row.company_name || '';
					t._ref_display = name && company
						? name + ' — ' + company
						: (name || company || t.reference_name);
				} else if (t.reference_type === 'Customer') {
					t._ref_display = row.customer_name || t.reference_name;
				} else if (t.reference_type === 'Opportunity') {
					t._ref_display = row.party_name || row.customer_name || t.reference_name;
				} else if (t.reference_type === 'HD Ticket') {
					t._ref_display = row.subject || t.reference_name;
				}
			});
			return tasks;
		});
	}

	// ---------------------------------------------------------------------

	render(tasks) {
		var esc = frappe.utils.escape_html;

		var priority_color = { 'High': 'red', 'Medium': 'yellow', 'Low': 'grey' };
		var status_color   = { 'Open': 'blue', 'Closed': 'green', 'Cancelled': 'grey' };
		var priority_short = { 'High': 'H', 'Medium': 'M', 'Low': 'L' };
		var status_short   = { 'Open': 'O', 'Closed': 'CL', 'Cancelled': 'CA' };

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

			// Reference label (top of first cell). Blue pill if Lead with the
			// resolved display name; plain muted if other ref.
			var ref_label = '';
			if (t.reference_type === 'Lead' && t.reference_name) {
				// Prefer the resolved display name; fall back to the lead code.
				var display = t._ref_display || t.reference_name;
				ref_label = '<a class="nest-lead-badge" data-lead="' + esc(t.reference_name) + '"'
					+ ' href="/app/lead-activity/' + encodeURIComponent(t.reference_name) + '"'
					+ ' title="Open Lead Activity Hub for ' + esc(t.reference_name) + '"'
					+ ' style="' + badge_style + '">'
					+ '<i class="fa fa-user" style="margin-right:4px;"></i>'
					+ esc(display)
					+ '</a>';
			} else if (t.reference_type && t.reference_name) {
				// Non-Lead ref — show "<DocType>: <display name or code>" muted.
				var ref_text = t._ref_display
					? (t.reference_type + ': ' + t._ref_display)
					: (t.reference_type + ': ' + t.reference_name);
				ref_label = '<span class="text-muted" style="font-size:11px;font-weight:500;">'
					+ esc(ref_text)
					+ '</span>';
			}

			// Description — full text, no truncation, word-wraps. frappe.utils.strip_html
			// doesn't exist in v16 — use jQuery to extract text.
			var plain = t.description ? $('<div>').html(t.description).text().trim() : '';
			var desc_html = plain
				? esc(plain)
				: '<em class="text-muted">No description</em>';

			// Combined first cell: ref label (if any) on top, description below, all wrapping.
			var first_cell = '<td style="white-space:normal;word-wrap:break-word;max-width:480px;">'
				+ (ref_label ? '<div style="margin-bottom:4px;">' + ref_label + '</div>' : '')
				+ '<div style="line-height:1.4;">' + desc_html + '</div>'
				+ '</td>';

			var date_str = t.date ? esc(frappe.datetime.str_to_user(t.date)) : '<span class="text-muted">—</span>';
			var assigned_to = t.allocated_to || t.owner || '—';

			// Short letter badges, with full word as tooltip.
			var priority_badge = t.priority
				? '<span class="indicator-pill ' + (priority_color[t.priority] || 'grey') + '" title="' + esc(t.priority) + '">'
					+ esc(priority_short[t.priority] || t.priority) + '</span>'
				: '<span class="text-muted">—</span>';

			var status_badge = '<span class="indicator-pill ' + (status_color[t.status] || 'grey') + '" title="' + esc(t.status || 'Open') + '">'
				+ esc(status_short[t.status] || (t.status || 'Open')) + '</span>';

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
				+ first_cell
				+ '<td style="white-space:nowrap;">' + date_str + '</td>'
				+ '<td>' + esc(assigned_to) + '</td>'
				+ '<td style="text-align:center;">' + priority_badge + '</td>'
				+ '<td style="text-align:center;">' + status_badge + '</td>'
				+ '<td style="white-space:nowrap;text-align:center;">' + action_btn + '</td>'
				+ '</tr>';
		}).join('');

		var table = '<div style="overflow-x:auto;">'
			+ '<table class="table table-bordered table-hover" style="font-size:13px;margin-bottom:0;background:var(--card-bg, #fff);">'
			+ '<thead style="background:var(--bg-light, #f4f7fa);">'
			+ '<tr>'
			+ '<th style="min-width:320px;">Customer / Task</th>'
			+ '<th style="width:110px;">Due Date</th>'
			+ '<th style="width:170px;">Assigned To</th>'
			+ '<th style="width:50px;text-align:center;" title="Priority">Pri</th>'
			+ '<th style="width:50px;text-align:center;" title="Status">Sts</th>'
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
