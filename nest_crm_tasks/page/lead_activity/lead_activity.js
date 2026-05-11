frappe.pages['lead-activity'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Lead Activity Hub',
		single_column: true
	});

	// Store page reference on wrapper for access in on_page_show
	wrapper.lead_activity_page = new LeadActivityHub(page, wrapper);
};

frappe.pages['lead-activity'].on_page_show = function(wrapper) {
	// Re-render when route changes (different lead selected)
	if (wrapper.lead_activity_page) {
		wrapper.lead_activity_page.load_from_route();
	}
};

// ---------------------------------------------------------------------------
// LeadActivityHub class
// ---------------------------------------------------------------------------

var LeadActivityHub = Class.extend({

	init: function(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.$main = $(wrapper).find('.lead-activity-hub');
		this.lead_name = null;
		this.lead_data = null;

		this.setup_page_actions();
		this.load_from_route();
	},

	// -------------------------------------------------------------------------
	// Setup
	// -------------------------------------------------------------------------

	setup_page_actions: function() {
		var me = this;

		// Primary action - View Full Profile
		this.page.set_primary_action('View Full Profile', function() {
			if (me.lead_name) {
				frappe.set_route('Form', 'Lead', me.lead_name);
			}
		}, 'octicon octicon-person');

		// Secondary action - Back to Tasks
		this.page.add_action_item('Back to My Tasks', function() {
			frappe.set_route('List', 'ToDo');
		});

		// Secondary action - Refresh
		this.page.add_action_item('Refresh', function() {
			me.render(me.lead_name);
		});
	},

	// -------------------------------------------------------------------------
	// Routing
	// -------------------------------------------------------------------------

	load_from_route: function() {
		// Route format: lead-activity/<lead_name>
		var route = frappe.get_route();
		// route[0] = 'lead-activity', route[1] = lead name (if present)
		var lead_name = route && route[1] ? decodeURIComponent(route[1]) : null;

		if (lead_name) {
			if (lead_name !== this.lead_name) {
				this.render(lead_name);
			}
		} else {
			this.show_empty_state();
		}
	},

	// -------------------------------------------------------------------------
	// Render
	// -------------------------------------------------------------------------

	render: function(lead_name) {
		var me = this;
		this.lead_name = lead_name;
		this.$main.html('<div class="text-muted text-center" style="padding:40px;">Loading...</div>');

		// Fetch lead + activities in parallel
		Promise.all([
			me.fetch_lead(lead_name),
			me.fetch_activities(lead_name)
		]).then(function(results) {
			me.lead_data = results[0];
			var activities = results[1];
			me.page.set_title(me.lead_data.lead_name || lead_name);
			me.$main.html('');
			me.render_header_card(me.lead_data);
			me.render_activity_table(activities);
		}).catch(function(err) {
			me.$main.html(
				'<div class="alert alert-danger" style="margin:20px;">'
				+ 'Could not load lead data. '
				+ (err && err.message ? frappe.utils.escape_html(err.message) : '')
				+ '</div>'
			);
		});
	},

	// -------------------------------------------------------------------------
	// Data fetching
	// -------------------------------------------------------------------------

	fetch_lead: function(lead_name) {
		return frappe.db.get_doc('Lead', lead_name);
	},

	fetch_activities: function(lead_name) {
		// Pull ToDo items linked to this lead
		return frappe.db.get_list('ToDo', {
			filters: [
				['reference_type', '=', 'Lead'],
				['reference_name', '=', lead_name]
			],
			fields: [
				'name',
				'description',
				'date',
				'assigned_by_full_name',
				'owner',
				'priority',
				'status',
				'modified'
			],
			order_by: 'date asc, priority desc',
			limit: 200
		});
	},

	// -------------------------------------------------------------------------
	// Header card
	// -------------------------------------------------------------------------

	render_header_card: function(lead) {
		var status_color = {
			'Lead': 'blue',
			'Open': 'blue',
			'Replied': 'yellow',
			'Opportunity': 'green',
			'Interested': 'green',
			'Converted': 'green',
			'Do Not Contact': 'red',
			'Lost Quotation': 'red'
		};

		var badge_color = status_color[lead.status] || 'grey';

		var company_line = [lead.company_name, lead.territory, lead.industry]
			.filter(Boolean).join(' &bull; ');

		var contact_line = [
			lead.email_id ? ('<a href="mailto:' + lead.email_id + '">' + frappe.utils.escape_html(lead.email_id) + '</a>') : '',
			lead.phone ? frappe.utils.escape_html(lead.phone) : '',
			lead.mobile_no ? frappe.utils.escape_html(lead.mobile_no) : ''
		].filter(Boolean).join(' &nbsp;|&nbsp; ');

		var owner_info = lead.lead_owner
			? ('Owned by <strong>' + frappe.utils.escape_html(lead.lead_owner) + '</strong>')
			: '';

		var source_info = lead.source
			? ('Source: <strong>' + frappe.utils.escape_html(lead.source) + '</strong>')
			: '';

		var meta_parts = [owner_info, source_info].filter(Boolean).join(' &nbsp;&bull;&nbsp; ');

		var html = '<div class="nest-lead-card" style="'
			+ 'background:#fff;'
			+ 'border:1px solid #d1d8dd;'
			+ 'border-left:4px solid #1B5EA0;'
			+ 'border-radius:4px;'
			+ 'padding:20px 24px;'
			+ 'margin-bottom:24px;'
			+ '">'

			// Name + status badge
			+ '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">'
			+ '<h3 style="margin:0;font-size:18px;font-weight:600;">'
			+ frappe.utils.escape_html(lead.lead_name || this.lead_name)
			+ '</h3>'
			+ '<span class="indicator-pill ' + badge_color + '">'
			+ frappe.utils.escape_html(lead.status || 'Unknown')
			+ '</span>'
			+ '</div>'

			// Company / territory / industry
			+ (company_line
				? '<div style="color:#6c757d;font-size:13px;margin-bottom:6px;">' + company_line + '</div>'
				: '')

			// Contact details
			+ (contact_line
				? '<div style="font-size:13px;margin-bottom:8px;">' + contact_line + '</div>'
				: '')

			// Owner + source meta
			+ (meta_parts
				? '<div style="font-size:12px;color:#6c757d;">' + meta_parts + '</div>'
				: '')

			+ '</div>';

		this.$main.append(html);
	},

	// -------------------------------------------------------------------------
	// Activity table
	// -------------------------------------------------------------------------

	render_activity_table: function(activities) {
		var me = this;

		var priority_color = {
			'High': 'red',
			'Medium': 'yellow',
			'Low': 'grey'
		};

		var status_color = {
			'Open': 'blue',
			'Closed': 'green',
			'Cancelled': 'grey'
		};

		// Summary counts
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
				+ 'No activities linked to this lead yet.'
				+ '</div>'
			);
			this.bind_add_task_btn();
			return;
		}

		// Build table
		var rows_html = activities.map(function(a) {
			var desc = a.description
				? frappe.utils.escape_html(
					frappe.utils.strip_html(a.description).substring(0, 120)
					+ (a.description.length > 120 ? '...' : '')
				)
				: '<em class="text-muted">No description</em>';

			var date_str = a.date
				? frappe.datetime.str_to_user(a.date)
				: '<span class="text-muted">--</span>';

			var assigned_to = a.assigned_by_full_name || a.owner || '--';

			var priority_badge = a.priority
				? '<span class="indicator-pill ' + (priority_color[a.priority] || 'grey') + '">' + a.priority + '</span>'
				: '--';

			var status_badge = '<span class="indicator-pill ' + (status_color[a.status] || 'grey') + '">' + (a.status || 'Open') + '</span>';

			var action_btn = (a.status === 'Open')
				? '<button class="btn btn-xs btn-success nest-complete-btn" data-todo="' + a.name + '">'
					+ 'Mark Complete</button>'
				: '<span class="text-muted" style="font-size:12px;">Done</span>';

			return '<tr data-todo="' + a.name + '">'
				+ '<td>' + desc + '</td>'
				+ '<td style="white-space:nowrap;">' + date_str + '</td>'
				+ '<td>' + frappe.utils.escape_html(assigned_to) + '</td>'
				+ '<td>' + priority_badge + '</td>'
				+ '<td>' + status_badge + '</td>'
				+ '<td style="white-space:nowrap;">' + action_btn + '</td>'
				+ '</tr>';
		}).join('');

		var table_html = '<div style="overflow-x:auto;">'
			+ '<table class="table table-bordered table-hover nest-activity-table" style="font-size:13px;margin-bottom:0;">'
			+ '<thead style="background:#f4f7fa;">'
			+ '<tr>'
			+ '<th style="min-width:260px;">Description</th>'
			+ '<th style="width:100px;">Due Date</th>'
			+ '<th style="width:140px;">Assigned To</th>'
			+ '<th style="width:90px;">Priority</th>'
			+ '<th style="width:90px;">Status</th>'
			+ '<th style="width:120px;">Action</th>'
			+ '</tr>'
			+ '</thead>'
			+ '<tbody>'
			+ rows_html
			+ '</tbody>'
			+ '</table>'
			+ '</div>';

		this.$main.append(table_html);
		this.bind_activity_table_events();
		this.bind_add_task_btn();
	},

	// -------------------------------------------------------------------------
	// Event binding
	// -------------------------------------------------------------------------

	bind_activity_table_events: function() {
		var me = this;

		// Mark Complete button
		this.$main.on('click', '.nest-complete-btn', function(e) {
			e.stopPropagation();
			var todo_name = $(this).data('todo');
			me.mark_complete(todo_name, $(this));
		});
	},

	bind_add_task_btn: function() {
		var me = this;
		this.$main.on('click', '.nest-add-task-btn', function() {
			me.open_new_task_dialog();
		});
	},

	// -------------------------------------------------------------------------
	// Actions
	// -------------------------------------------------------------------------

	mark_complete: function(todo_name, $btn) {
		var me = this;
		$btn.prop('disabled', true).text('Saving...');

		frappe.db.set_value('ToDo', todo_name, 'status', 'Closed')
			.then(function() {
				frappe.show_alert({ message: 'Task marked complete', indicator: 'green' });
				// Re-render the table
				me.render(me.lead_name);
			})
			.catch(function(err) {
				frappe.show_alert({ message: 'Could not update task', indicator: 'red' });
				$btn.prop('disabled', false).text('Mark Complete');
			});
	},

	open_new_task_dialog: function() {
		var me = this;

		var d = new frappe.ui.Dialog({
			title: 'Add Activity / Task',
			fields: [
				{
					fieldname: 'description',
					fieldtype: 'Small Text',
					label: 'Description',
					reqd: 1
				},
				{
					fieldname: 'date',
					fieldtype: 'Date',
					label: 'Due Date',
					default: frappe.datetime.nowdate()
				},
				{
					fieldname: 'priority',
					fieldtype: 'Select',
					label: 'Priority',
					options: 'Low\nMedium\nHigh',
					default: 'Medium'
				}
			],
			primary_action_label: 'Add Task',
			primary_action: function(values) {
				frappe.db.insert({
					doctype: 'ToDo',
					description: values.description,
					date: values.date || null,
					priority: values.priority,
					reference_type: 'Lead',
					reference_name: me.lead_name,
					assigned_by: frappe.session.user,
					status: 'Open'
				}).then(function() {
					frappe.show_alert({ message: 'Task added', indicator: 'green' });
					d.hide();
					me.render(me.lead_name);
				}).catch(function() {
					frappe.show_alert({ message: 'Could not add task', indicator: 'red' });
				});
			}
		});

		d.show();
	},

	// -------------------------------------------------------------------------
	// Empty state
	// -------------------------------------------------------------------------

	show_empty_state: function() {
		this.$main.html(
			'<div class="text-muted text-center" style="padding:60px;">'
			+ '<div style="font-size:48px;margin-bottom:16px;">&#128203;</div>'
			+ '<p>No lead selected.</p>'
			+ '<p>Click a task in <a href="/app/todo">My Tasks</a> to open the Lead Activity Hub.</p>'
			+ '</div>'
		);
		this.page.set_title('Lead Activity Hub');
	}

});
