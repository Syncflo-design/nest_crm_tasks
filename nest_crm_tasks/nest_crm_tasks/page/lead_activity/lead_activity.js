// nest_crm_tasks — Lead Activity Hub
// Page wiring: /app/lead-activity/<lead_name>

frappe.pages['lead-activity'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Lead Activity Hub',
		single_column: true
	});

	wrapper.lead_activity_page = new LeadActivityHub(page, wrapper);
};

frappe.pages['lead-activity'].on_page_show = function(wrapper) {
	if (wrapper.lead_activity_page) {
		wrapper.lead_activity_page.load_from_route();
	}
};

// ---------------------------------------------------------------------------
// LeadActivityHub
// ---------------------------------------------------------------------------

class LeadActivityHub {

	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;

		// v16 modern desk: page.body is a jQuery object (NOT a DOM element). Create our
		// own container inside it — `$(wrapper).find('.lead-activity-hub')` returns an
		// empty collection because nothing creates that div. See
		// gotchas/2026-05-10-frappe-v16-page-api-drift.md.
		this.$main = $('<div class="lead-activity-hub"></div>').appendTo(page.body);

		this.lead_name = null;
		this.lead_data = null;

		this.setup_page_actions();
		this.bind_table_events();   // bound ONCE — handlers don't accumulate across renders
		this.load_from_route();
	}

	// -------------------------------------------------------------------------
	// Setup
	// -------------------------------------------------------------------------

	setup_page_actions() {
		var me = this;

		// Primary: View Full Profile (with user icon)
		this.page.set_primary_action('<i class="fa fa-user" style="margin-right:6px;"></i>View Full Profile', function() {
			if (me.lead_name) {
				frappe.set_route('Form', 'Lead', me.lead_name);
			}
		});

		// Secondary: a visible "back" button so reps don't have to dig through Actions
		this.page.set_secondary_action('<i class="fa fa-arrow-left" style="margin-right:6px;"></i>My Activities', function() {
			frappe.set_route('my-activities');
		});

		this.page.add_action_item('Back to My Activities', function() {
			frappe.set_route('my-activities');
		});

		this.page.add_action_item('Refresh', function() {
			if (me.lead_name) me.render(me.lead_name);
		});
	}

	bind_table_events() {
		var me = this;

		this.$main.on('click', '.nest-complete-btn', function(e) {
			e.stopPropagation();
			var $btn = $(this);
			var todo_name = $btn.data('todo');
			// Confirm before closing — prevents accidental clicks on the icon-only button.
			frappe.confirm(
				'Mark this task as complete?',
				function() { me.mark_complete(todo_name, $btn); }
			);
		});

		this.$main.on('click', '.nest-reopen-btn', function(e) {
			e.stopPropagation();
			me.reopen_task($(this).data('todo'), $(this));
		});

		this.$main.on('click', '.nest-add-task-btn', function(e) {
			e.preventDefault();
			me.open_new_task_dialog();
		});
	}

	// -------------------------------------------------------------------------
	// Routing
	// -------------------------------------------------------------------------

	load_from_route() {
		var route = frappe.get_route();
		var lead_name = (route && route[1]) ? decodeURIComponent(route[1]) : null;

		if (lead_name) {
			if (lead_name !== this.lead_name) {
				this.render(lead_name);
			}
		} else {
			this.show_empty_state();
		}
	}

	// -------------------------------------------------------------------------
	// Render
	// -------------------------------------------------------------------------

	render(lead_name) {
		var me = this;
		this.lead_name = lead_name;
		this.$main.html('<div class="text-muted text-center" style="padding:40px;">Loading…</div>');

		Promise.all([
			me.fetch_lead(lead_name),
			me.fetch_activities(lead_name)
		]).then(function(results) {
			me.lead_data = results[0];
			var activities = results[1];
			me.page.set_title(frappe.utils.escape_html(me.lead_data.lead_name || lead_name));
			me.$main.html('');
			me.render_header_card(me.lead_data);
			me.render_activity_table(activities);
		}).catch(function(err) {
			var msg = (err && err.message)
				? frappe.utils.escape_html(err.message)
				: 'Lead not found or you do not have permission to view it.';
			me.$main.html(
				'<div class="alert alert-danger" style="margin:20px;">'
				+ 'Could not load lead data. ' + msg
				+ '</div>'
			);
		});
	}

	// -------------------------------------------------------------------------
	// Data fetching
	// -------------------------------------------------------------------------

	fetch_lead(lead_name) {
		return frappe.db.get_doc('Lead', lead_name);
	}

	fetch_activities(lead_name) {
		return frappe.db.get_list('ToDo', {
			filters: [
				['reference_type', '=', 'Lead'],
				['reference_name', '=', lead_name]
			],
			fields: [
				'name', 'description', 'date',
				'allocated_to',
				'assigned_by', 'owner',
				'priority', 'status', 'modified'
			],
			order_by: 'date asc, modified desc',
			limit: 200
		}).then(function(activities) {
			// Priority sort client-side so High > Medium > Low (ToDo priority is a Select string,
			// so a SQL DESC sorts alphabetically — Medium > Low > High — which is not what anyone wants).
			var rank = { High: 0, Medium: 1, Low: 2 };
			activities.sort(function(a, b) {
				var ad = a.date || '9999-12-31';
				var bd = b.date || '9999-12-31';
				if (ad !== bd) return ad < bd ? -1 : 1;
				return (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99);
			});
			return activities;
		});
	}

	// -------------------------------------------------------------------------
	// Header card
	// -------------------------------------------------------------------------

	render_header_card(lead) {
		var esc = frappe.utils.escape_html;

		var status_color = {
			'Lead': 'blue',
			'Open': 'blue',
			'Replied': 'yellow',
			'Opportunity': 'green',
			'Quotation': 'green',
			'Interested': 'green',
			'Converted': 'green',
			'Do Not Contact': 'red',
			'Lost Quotation': 'red'
		};
		var badge_color = status_color[lead.status] || 'grey';

		var sep = ' <span style="color:var(--border-color, #d1d8dd);">&bull;</span> ';

		// Top-line meta: Company name (bold) • email • mobile (normal weight)
		var top_chunks = [];
		if (lead.company_name) top_chunks.push('<strong>' + esc(lead.company_name) + '</strong>');
		if (lead.email_id) {
			top_chunks.push(
				'<a href="mailto:' + encodeURIComponent(lead.email_id) + '">'
				+ esc(lead.email_id) + '</a>'
			);
		}
		// Mobile preferred; fall back to phone if mobile is empty.
		var contact_number = lead.mobile_no || lead.phone;
		if (contact_number) top_chunks.push(esc(contact_number));
		var top_line = top_chunks.join(sep);

		// Bottom-line meta: Territory • Industry • Owner • Source (normal, muted)
		var bottom_chunks = [];
		if (lead.territory)  bottom_chunks.push(esc(lead.territory));
		if (lead.industry)   bottom_chunks.push(esc(lead.industry));
		if (lead.lead_owner) bottom_chunks.push('Owner: ' + esc(lead.lead_owner));
		if (lead.source)     bottom_chunks.push('Source: ' + esc(lead.source));
		var bottom_line = bottom_chunks.join(sep);

		var pipe = '<span style="color:var(--border-color, #d1d8dd);margin:0 4px;">|</span>';

		var html = '<div class="nest-lead-card" style="'
			+ 'background:var(--card-bg, #fff);'
			+ 'border:1px solid var(--border-color, #d1d8dd);'
			+ 'border-left:4px solid #1B5EA0;'
			+ 'border-radius:4px;'
			+ 'padding:10px 14px;'
			+ 'margin-bottom:12px;'
			+ 'font-size:13px;'
			+ 'line-height:1.5;'
			+ '">'

			// Top row: Lead Name | top_line
			+ '<div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:4px;">'
			+ '<span style="font-size:15px;font-weight:600;white-space:nowrap;">'
			+ esc(lead.lead_name || this.lead_name)
			+ '</span>'
			+ (top_line ? pipe + '<span style="min-width:0;">' + top_line + '</span>' : '')
			+ '</div>'

			// Bottom row: Status badge | bottom_line  (muted)
			+ '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:4px;color:var(--text-muted, #6c757d);">'
			+ '<span class="indicator-pill ' + badge_color + '" style="font-size:11px;">'
			+ esc(lead.status || 'Unknown')
			+ '</span>'
			+ (bottom_line ? pipe + '<span style="min-width:0;">' + bottom_line + '</span>' : '')
			+ '</div>'

			+ '</div>';

		this.$main.append(html);
	}

	// -------------------------------------------------------------------------
	// Activity table
	// -------------------------------------------------------------------------

	render_activity_table(activities) {
		var esc = frappe.utils.escape_html;

		var priority_color = { 'High': 'red', 'Medium': 'yellow', 'Low': 'grey' };
		var status_color   = { 'Open': 'blue', 'Closed': 'green', 'Cancelled': 'grey' };

		var open_count = activities.filter(function(a) { return a.status === 'Open'; }).length;
		var total = activities.length;

		var summary_html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
			+ '<h5 style="margin:0;font-weight:600;">Activities ('
			+ total + ' total, ' + open_count + ' open)</h5>'
			+ '<button class="btn btn-xs btn-default nest-add-task-btn">'
			+ '<i class="fa fa-plus"></i> Add Task</button>'
			+ '</div>';

		this.$main.append(summary_html);

		if (total === 0) {
			this.$main.append(
				'<div class="text-muted" style="padding:24px;text-align:center;">'
				+ 'No activities linked to this lead yet. '
				+ '<a href="#" class="nest-add-task-btn"><strong>Add the first one</strong></a>.'
				+ '</div>'
			);
			return;
		}

		var rows_html = activities.map(function(a) {
			var safe_name = esc(a.name);

			// frappe.utils.strip_html doesn't exist in v16 — use jQuery to extract text
			var plain = a.description ? $('<div>').html(a.description).text() : '';
			var desc = plain
				? esc(plain.substring(0, 120)) + (plain.length > 120 ? '…' : '')
				: '<em class="text-muted">No description</em>';

			var date_str = a.date
				? esc(frappe.datetime.str_to_user(a.date))
				: '<span class="text-muted">--</span>';

			var assigned_to = a.allocated_to || a.owner || '--';

			var priority_badge = a.priority
				? '<span class="indicator-pill ' + (priority_color[a.priority] || 'grey') + '">'
					+ esc(a.priority) + '</span>'
				: '--';

			var status_badge = '<span class="indicator-pill ' + (status_color[a.status] || 'grey') + '">'
				+ esc(a.status || 'Open') + '</span>';

			// Icon-only action buttons with tooltips — saves horizontal space.
			var action_btn;
			if (a.status === 'Open') {
				action_btn = '<button class="btn btn-xs btn-success nest-complete-btn" data-todo="'
					+ safe_name + '" title="Mark as Complete" aria-label="Mark as Complete">'
					+ '<i class="fa fa-check"></i></button>';
			} else if (a.status === 'Closed') {
				action_btn = '<button class="btn btn-xs btn-default nest-reopen-btn" data-todo="'
					+ safe_name + '" title="Reopen" aria-label="Reopen">'
					+ '<i class="fa fa-undo"></i></button>';
			} else {
				action_btn = '<span class="text-muted" style="font-size:12px;">' + esc(a.status) + '</span>';
			}

			return '<tr data-todo="' + safe_name + '">'
				+ '<td>' + desc + '</td>'
				+ '<td style="white-space:nowrap;">' + date_str + '</td>'
				+ '<td>' + esc(assigned_to) + '</td>'
				+ '<td>' + priority_badge + '</td>'
				+ '<td>' + status_badge + '</td>'
				+ '<td style="white-space:nowrap;">' + action_btn + '</td>'
				+ '</tr>';
		}).join('');

		var table_html = '<div style="overflow-x:auto;">'
			+ '<table class="table table-bordered table-hover nest-activity-table" style="font-size:13px;margin-bottom:0;">'
			+ '<thead style="background:var(--bg-light, #f4f7fa);">'
			+ '<tr>'
			+ '<th style="min-width:260px;">Description</th>'
			+ '<th style="width:100px;">Due Date</th>'
			+ '<th style="width:160px;">Assigned To</th>'
			+ '<th style="width:90px;">Priority</th>'
			+ '<th style="width:90px;">Status</th>'
			+ '<th style="width:60px;text-align:center;">Action</th>'
			+ '</tr>'
			+ '</thead>'
			+ '<tbody>' + rows_html + '</tbody>'
			+ '</table>'
			+ '</div>';

		this.$main.append(table_html);
	}

	// -------------------------------------------------------------------------
	// Actions
	// -------------------------------------------------------------------------

	mark_complete(todo_name, $btn) {
		var me = this;
		$btn.prop('disabled', true).text('Saving…');

		frappe.db.set_value('ToDo', todo_name, 'status', 'Closed')
			.then(function() {
				frappe.show_alert({ message: 'Task marked complete', indicator: 'green' });
				me.render(me.lead_name);
			})
			.catch(function() {
				frappe.show_alert({ message: 'Could not update task', indicator: 'red' });
				$btn.prop('disabled', false).text('Mark Complete');
			});
	}

	reopen_task(todo_name, $btn) {
		var me = this;
		$btn.prop('disabled', true).text('Saving…');

		frappe.db.set_value('ToDo', todo_name, 'status', 'Open')
			.then(function() {
				frappe.show_alert({ message: 'Task reopened', indicator: 'blue' });
				me.render(me.lead_name);
			})
			.catch(function() {
				frappe.show_alert({ message: 'Could not reopen task', indicator: 'red' });
				$btn.prop('disabled', false).text('Reopen');
			});
	}

	open_new_task_dialog() {
		var me = this;

		var d = new frappe.ui.Dialog({
			title: 'Add Activity / Task',
			fields: [
				{ fieldname: 'description', fieldtype: 'Small Text', label: 'Description', reqd: 1 },
				{ fieldname: 'date',        fieldtype: 'Date',       label: 'Due Date',    default: frappe.datetime.nowdate() },
				{ fieldname: 'priority',    fieldtype: 'Select',     label: 'Priority',
				  options: 'Low\nMedium\nHigh', default: 'Medium' },
				{ fieldname: 'allocated_to', fieldtype: 'Link',      label: 'Assign To',
				  options: 'User', default: frappe.session.user }
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
					reference_type: 'Lead',
					reference_name: me.lead_name,
					assigned_by: frappe.session.user,
					status: 'Open'
				}).then(function() {
					frappe.show_alert({ message: 'Task added', indicator: 'green' });
					d.hide();
					me.render(me.lead_name);
				}).catch(function() {
					d.enable_primary_action();
					frappe.show_alert({ message: 'Could not add task', indicator: 'red' });
				});
			}
		});

		d.show();
	}

	// -------------------------------------------------------------------------
	// Empty state
	// -------------------------------------------------------------------------

	show_empty_state() {
		this.$main.html(
			'<div class="text-muted text-center" style="padding:60px;">'
			+ '<div style="font-size:48px;margin-bottom:16px;">&#128203;</div>'
			+ '<p>No lead selected.</p>'
			+ '<p>Click a task in <a href="/app/todo">My Tasks</a> to open the Lead Activity Hub.</p>'
			+ '</div>'
		);
		this.page.set_title('Lead Activity Hub');
	}
}
