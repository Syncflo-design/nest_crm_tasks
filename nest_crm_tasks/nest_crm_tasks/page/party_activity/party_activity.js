// nest_crm_tasks — Party Activity Hub
// Page wiring: /app/party-activity/<party_type>/<party_name>
//   party_type ∈ {Lead, Customer}
//   party_name = the linked doctype's name
//
// Generalised from the previous /app/lead-activity page so both Leads (all
// statuses) and Customers go through the same screen. ToDo's reference_type
// is generic — the filter just passes whatever party_type the URL carries.

frappe.pages['party-activity'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Party Activity Hub',
		single_column: true
	});

	wrapper.party_activity_page = new PartyActivityHub(page, wrapper);
};

frappe.pages['party-activity'].on_page_show = function(wrapper) {
	if (wrapper.party_activity_page) {
		wrapper.party_activity_page.load_from_route();
	}
};


class PartyActivityHub {

	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;

		// v16 modern desk: page.body is jQuery; create own container (gotcha 2026-05-10 v2).
		this.$main = $('<div class="party-activity-hub"></div>').appendTo(page.body);

		this.party_type = null;
		this.party_name = null;
		this.party_data = null;
		this.require_followup = true;  // default until settings load

		this.setup_page_actions();
		this.bind_table_events();
		this.load_from_route();
		this.load_settings();
	}

	setup_page_actions() {
		var me = this;

		this.page.set_primary_action('<i class="fa fa-user" style="margin-right:6px;"></i>View Full Profile', function() {
			if (me.party_type && me.party_name) {
				frappe.set_route('Form', me.party_type, me.party_name);
			}
		});

		this.page.set_secondary_action('<i class="fa fa-arrow-left" style="margin-right:6px;"></i>My Activities', function() {
			frappe.set_route('my-activities');
		});

		this.page.add_action_item('Back to My Activities', function() {
			frappe.set_route('my-activities');
		});

		this.page.add_action_item('Refresh', function() {
			if (me.party_type && me.party_name) me.render(me.party_type, me.party_name);
		});
	}

	bind_table_events() {
		var me = this;

		this.$main.on('click', '.nest-complete-btn', function(e) {
			e.stopPropagation();
			var $btn = $(this);
			var todo_name = $btn.data('todo');
			frappe.confirm(
				'Mark this task as complete?',
				function() { me.mark_complete(todo_name, $btn); }
			);
		});

		this.$main.on('click', '.nest-reopen-btn', function(e) {
			e.stopPropagation();
			me.reopen_task($(this).data('todo'), $(this));
		});

		this.$main.on('click', '.nest-edit-btn', function(e) {
			e.stopPropagation();
			me.open_edit_task_dialog($(this).data('todo'));
		});

		this.$main.on('click', '.nest-add-task-btn', function(e) {
			e.preventDefault();
			me.open_new_task_dialog();
		});

		this.$main.on('click', '.nest-followup-btn', function(e) {
			e.stopPropagation();
			me.open_followup_dialog($(this).data('todo'));
		});
	}

	load_settings() {
		var me = this;
		frappe.call({
			method: 'nest_crm_tasks.nest_crm_tasks.api.get_crm_tasks_settings',
			async: true,
			callback: function(r) {
				if (r && r.message) {
					me.require_followup = r.message.require_followup_on_complete;
				}
			}
		});
	}

	// Due date is mandatory except for Leads in a terminal status (lost/dead).
	// Customers always require a next due date.
	due_required() {
		if (this.party_type === 'Lead' && this.party_data) {
			var s = this.party_data.status;
			if (s === 'Lost Quotation' || s === 'Do Not Contact') return false;
		}
		return true;
	}

	// -------------------------------------------------------------------------
	// Routing — /app/party-activity/<party_type>/<party_name>
	// -------------------------------------------------------------------------

	load_from_route() {
		var route = frappe.get_route();
		var party_type = (route && route[1]) ? decodeURIComponent(route[1]) : null;
		var party_name = (route && route[2]) ? decodeURIComponent(route[2]) : null;

		if (party_type && party_name) {
			if (party_type !== this.party_type || party_name !== this.party_name) {
				this.render(party_type, party_name);
			}
		} else {
			this.show_empty_state();
		}
	}

	// -------------------------------------------------------------------------
	// Render
	// -------------------------------------------------------------------------

	render(party_type, party_name) {
		var me = this;
		this.party_type = party_type;
		this.party_name = party_name;
		this.$main.html('<div class="text-muted text-center" style="padding:40px;">Loading…</div>');

		Promise.all([
			me.fetch_party(party_type, party_name),
			me.fetch_activities(party_type, party_name)
		]).then(function(results) {
			me.party_data = results[0];
			var activities = results[1];

			var title = (party_type === 'Lead')
				? (me.party_data.lead_name || party_name)
				: (me.party_data.customer_name || party_name);
			me.page.set_title(frappe.utils.escape_html(title));

			me.$main.html('');
			if (party_type === 'Lead') {
				me.render_lead_header(me.party_data);
			} else {
				me.render_customer_header(me.party_data);
			}
			me.render_activity_table(activities);
		}).catch(function(err) {
			var msg = (err && err.message)
				? frappe.utils.escape_html(err.message)
				: (party_type + ' not found or you do not have permission to view it.');
			me.$main.html(
				'<div class="alert alert-danger" style="margin:20px;">'
				+ 'Could not load ' + frappe.utils.escape_html(party_type.toLowerCase()) + ' data. ' + msg
				+ '</div>'
			);
		});
	}

	// -------------------------------------------------------------------------
	// Data fetching
	// -------------------------------------------------------------------------

	fetch_party(party_type, party_name) {
		return frappe.db.get_doc(party_type, party_name);
	}

	fetch_activities(party_type, party_name) {
		return frappe.db.get_list('ToDo', {
			filters: [
				['reference_type', '=', party_type],
				['reference_name', '=', party_name]
			],
			fields: [
				'name', 'description', 'date',
				'allocated_to',
				'assigned_by', 'owner',
				'priority', 'status', 'modified',
				'task_type'
			],
			order_by: 'date desc, modified desc',
			limit: 200
		}).then(function(activities) {
			var rank = { High: 0, Medium: 1, Low: 2 };
			activities.sort(function(a, b) {
				// Most recent (latest due date) at the top, oldest at the bottom.
				// Undated tasks sink to the bottom (treated as the oldest).
				var ad = a.date || '0000-00-00';
				var bd = b.date || '0000-00-00';
				if (ad !== bd) return ad > bd ? -1 : 1;
				return (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99);
			});
			return activities;
		});
	}

	// -------------------------------------------------------------------------
	// Header — Lead
	// -------------------------------------------------------------------------

	render_lead_header(lead) {
		var esc = frappe.utils.escape_html;

		var status_color = {
			'Lead': 'blue', 'Open': 'blue', 'Replied': 'yellow',
			'Opportunity': 'green', 'Quotation': 'green', 'Interested': 'green',
			'Converted': 'green', 'Do Not Contact': 'red', 'Lost Quotation': 'red'
		};
		var badge_color = status_color[lead.status] || 'grey';

		var sep = ' <span style="color:var(--border-color, #d1d8dd);">&bull;</span> ';

		var top_chunks = [];
		if (lead.company_name) top_chunks.push('<strong>' + esc(lead.company_name) + '</strong>');
		if (lead.email_id) {
			top_chunks.push('<a href="mailto:' + encodeURIComponent(lead.email_id) + '">' + esc(lead.email_id) + '</a>');
		}
		var contact_number = lead.mobile_no || lead.phone;
		if (contact_number) top_chunks.push(esc(contact_number));
		var top_line = top_chunks.join(sep);

		var bottom_chunks = [];
		if (lead.territory)  bottom_chunks.push(esc(lead.territory));
		if (lead.industry)   bottom_chunks.push(esc(lead.industry));
		if (lead.lead_owner) bottom_chunks.push('Owner: ' + esc(lead.lead_owner));
		if (lead.source)     bottom_chunks.push('Source: ' + esc(lead.source));
		var bottom_line = bottom_chunks.join(sep);

		this.$main.append(this._render_card({
			heading: lead.lead_name || this.party_name,
			top_line: top_line,
			badge_color: badge_color,
			badge_label: lead.status || 'Unknown',
			bottom_line: bottom_line,
			accent_color: '#1B5EA0'
		}));
	}

	// -------------------------------------------------------------------------
	// Header — Customer
	// -------------------------------------------------------------------------

	render_customer_header(customer) {
		var esc = frappe.utils.escape_html;
		var sep = ' <span style="color:var(--border-color, #d1d8dd);">&bull;</span> ';

		var top_chunks = [];
		if (customer.customer_group) top_chunks.push('<strong>' + esc(customer.customer_group) + '</strong>');
		if (customer.email_id) {
			top_chunks.push('<a href="mailto:' + encodeURIComponent(customer.email_id) + '">' + esc(customer.email_id) + '</a>');
		}
		var contact_number = customer.mobile_no || customer.phone;
		if (contact_number) top_chunks.push(esc(contact_number));
		var top_line = top_chunks.join(sep);

		var bottom_chunks = [];
		if (customer.customer_type)  bottom_chunks.push(esc(customer.customer_type));
		if (customer.territory)      bottom_chunks.push(esc(customer.territory));
		if (customer.tax_id)         bottom_chunks.push('Tax: ' + esc(customer.tax_id));
		var bottom_line = bottom_chunks.join(sep);

		// Customers don't carry a status field like Leads. Show "Active" / "Disabled"
		// based on the disabled flag instead.
		var disabled = !!customer.disabled;

		this.$main.append(this._render_card({
			heading: customer.customer_name || this.party_name,
			top_line: top_line,
			badge_color: disabled ? 'grey' : 'green',
			badge_label: disabled ? 'Disabled' : 'Active',
			bottom_line: bottom_line,
			accent_color: '#1B5EA0'
		}));
	}

	_render_card(opts) {
		var esc = frappe.utils.escape_html;
		var pipe = '<span style="color:var(--border-color, #d1d8dd);margin:0 4px;">|</span>';

		return '<div class="nest-party-card" style="'
			+ 'background:var(--card-bg, #fff);'
			+ 'border:1px solid var(--border-color, #d1d8dd);'
			+ 'border-left:4px solid ' + (opts.accent_color || '#1B5EA0') + ';'
			+ 'border-radius:4px;padding:10px 14px;margin-bottom:12px;'
			+ 'font-size:13px;line-height:1.5;">'

			+ '<div style="display:flex;align-items:baseline;flex-wrap:wrap;gap:4px;">'
			+ '<span style="font-size:15px;font-weight:600;white-space:nowrap;">' + esc(opts.heading) + '</span>'
			+ (opts.top_line ? pipe + '<span style="min-width:0;">' + opts.top_line + '</span>' : '')
			+ '</div>'

			+ '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:4px;color:var(--text-muted, #6c757d);">'
			+ '<span class="indicator-pill ' + (opts.badge_color || 'grey') + '" style="font-size:11px;">' + esc(opts.badge_label || '') + '</span>'
			+ (opts.bottom_line ? pipe + '<span style="min-width:0;">' + opts.bottom_line + '</span>' : '')
			+ '</div>'

			+ '</div>';
	}

	// -------------------------------------------------------------------------
	// Activity table
	// -------------------------------------------------------------------------

	render_activity_table(activities) {
		var esc = frappe.utils.escape_html;

		var priority_color = { 'High': 'red', 'Medium': 'yellow', 'Low': 'grey' };
		var status_color   = { 'Open': 'blue', 'Closed': 'green', 'Cancelled': 'grey' };
		var priority_short = { 'High': 'H', 'Medium': 'M', 'Low': 'L' };
		var status_short   = { 'Open': 'O', 'Closed': 'CL', 'Cancelled': 'CA' };

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
				+ 'No activities linked to this ' + esc(this.party_type.toLowerCase()) + ' yet. '
				+ '<a href="#" class="nest-add-task-btn"><strong>Add the first one</strong></a>.'
				+ '</div>'
			);
			return;
		}

		var rows_html = activities.map(function(a) {
			var safe_name = esc(a.name);

			var plain = a.description ? $('<div>').html(a.description).text().trim() : '';
			var desc = plain ? esc(plain) : '<em class="text-muted">No description</em>';

			var date_str = a.date
				? esc(frappe.datetime.str_to_user(a.date))
				: '<span class="text-muted">--</span>';

			var assigned_to = a.allocated_to || a.owner || '--';

			var priority_badge = a.priority
				? '<span class="indicator-pill ' + (priority_color[a.priority] || 'grey') + '" title="' + esc(a.priority) + '">'
					+ esc(priority_short[a.priority] || a.priority) + '</span>'
				: '--';

			var status_badge = '<span class="indicator-pill ' + (status_color[a.status] || 'grey') + '" title="' + esc(a.status || 'Open') + '">'
				+ esc(status_short[a.status] || (a.status || 'Open')) + '</span>';

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

			// Follow-up: spawns a new task on this same party, recording this task
			// as its parent. Available on every row since the party link is implicit.
			var followup_btn = '<button class="btn btn-xs btn-default nest-followup-btn" data-todo="'
				+ safe_name + '" title="Add follow-up task" aria-label="Add follow-up task" style="margin-right:4px;">'
				+ '<i class="fa fa-reply"></i></button>';

			// Edit is restricted to the task owner (creator), not the assignee.
			var edit_btn = (a.owner === frappe.session.user)
				? '<button class="btn btn-xs btn-default nest-edit-btn" data-todo="'
					+ safe_name + '" title="Edit" aria-label="Edit" style="margin-right:4px;">'
					+ '<i class="fa fa-pencil"></i></button>'
				: '';
			action_btn = followup_btn + edit_btn + action_btn;

			return '<tr data-todo="' + safe_name + '">'
				+ '<td style="white-space:normal;word-wrap:break-word;max-width:480px;line-height:1.4;">' + desc + '</td>'
				+ '<td style="white-space:nowrap;">' + date_str + '</td>'
				+ '<td>' + esc(assigned_to) + '</td>'
				+ '<td style="text-align:center;">' + priority_badge + '</td>'
				+ '<td style="text-align:center;">' + status_badge + '</td>'
				+ '<td style="white-space:nowrap;text-align:center;">' + action_btn + '</td>'
				+ '</tr>';
		}).join('');

		var table_html = '<div style="overflow-x:auto;">'
			+ '<table class="table table-bordered table-hover nest-activity-table" style="font-size:13px;margin-bottom:0;">'
			+ '<thead style="background:var(--bg-light, #f4f7fa);">'
			+ '<tr>'
			+ '<th style="min-width:320px;">Description</th>'
			+ '<th style="width:100px;">Due Date</th>'
			+ '<th style="width:160px;">Assigned To</th>'
			+ '<th style="width:50px;text-align:center;" title="Priority">Pri</th>'
			+ '<th style="width:50px;text-align:center;" title="Status">Sts</th>'
			+ '<th style="width:110px;text-align:center;">Action</th>'
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
				me.render(me.party_type, me.party_name);
				// Offer follow-up dialog. Mandatory only if the setting is on
				// AND the party isn't in a terminal status.
				var mandatory = me.require_followup && me.due_required();
				me.open_followup_dialog(todo_name, mandatory);
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
				me.render(me.party_type, me.party_name);
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
				{ fieldname: 'date',        fieldtype: 'Date',       label: 'Next Task Due Date',
				  default: frappe.datetime.nowdate(), reqd: me.due_required() ? 1 : 0 },
				{ fieldname: 'task_type',   fieldtype: 'Link',       label: 'Task Type',   options: 'Task Type' },
				{ fieldname: 'priority',    fieldtype: 'Select',     label: 'Priority',
				  options: 'Low\nMedium\nHigh', default: 'Medium' },
				{ fieldname: 'allocated_to', fieldtype: 'Link',      label: 'Assign To',
				  options: 'User', default: frappe.session.user }
			],
			primary_action_label: 'Add Task',
			primary_action: function(values) {
				d.disable_primary_action();

				var payload = {
					doctype: 'ToDo',
					description: values.description,
					date: values.date || null,
					priority: values.priority,
					allocated_to: values.allocated_to || frappe.session.user,
					reference_type: me.party_type,
					reference_name: me.party_name,
					assigned_by: frappe.session.user,
					status: 'Open'
				};
				if (values.task_type) payload.task_type = values.task_type;

				frappe.db.insert(payload).then(function() {
					frappe.show_alert({ message: 'Task added', indicator: 'green' });
					d.hide();
					me.render(me.party_type, me.party_name);
				}).catch(function() {
					d.enable_primary_action();
					frappe.show_alert({ message: 'Could not add task', indicator: 'red' });
				});
			}
		});

		d.show();
	}

	// -------------------------------------------------------------------------
	// Follow-up — a new task on this same party, recording the source task as its
	// parent_task. Same party link as open_new_task_dialog, plus the parent chain.
	// -------------------------------------------------------------------------

	open_followup_dialog(parent_todo, mandatory) {
		var me = this;
		var allow_close = false;

		var party_name = (me.party_data
			&& (me.party_data.lead_name || me.party_data.customer_name)) || me.party_name;
		var party_label = party_name + ' (' + me.party_type + ')';

		var info = mandatory
			? '<div class="text-muted" style="margin-bottom:8px;">'
				+ 'A next step is required before you can close this. Follow-up linked to <strong>'
				+ frappe.utils.escape_html(party_label) + '</strong>'
				+ '</div>'
			: '<div class="text-muted" style="margin-bottom:8px;">'
				+ 'Follow-up linked to <strong>' + frappe.utils.escape_html(party_label) + '</strong>'
				+ '</div>';

		var d = new frappe.ui.Dialog({
			title: 'Add Follow-up Task',
			fields: [
				{ fieldtype: 'HTML', fieldname: 'linked_info', options: info },
				{ fieldname: 'description', fieldtype: 'Small Text', label: 'Description', reqd: 1 },
				{ fieldname: 'date',        fieldtype: 'Date',       label: 'Next Task Due Date',
				  default: frappe.datetime.nowdate(), reqd: me.due_required() ? 1 : 0 },
				{ fieldname: 'task_type',   fieldtype: 'Link',       label: 'Task Type', options: 'Task Type' },
				{ fieldname: 'priority',    fieldtype: 'Select',     label: 'Priority',
				  options: 'Low\nMedium\nHigh', default: 'Medium' },
				{ fieldname: 'allocated_to', fieldtype: 'Link',      label: 'Assign To',
				  options: 'User', default: frappe.session.user }
			],
			primary_action_label: 'Add Follow-up',
			primary_action: function(values) {
				d.disable_primary_action();

				var payload = {
					doctype: 'ToDo',
					description: values.description,
					date: values.date || null,
					priority: values.priority,
					allocated_to: values.allocated_to || frappe.session.user,
					reference_type: me.party_type,
					reference_name: me.party_name,
					parent_task: parent_todo || null,
					assigned_by: frappe.session.user,
					status: 'Open'
				};
				if (values.task_type) payload.task_type = values.task_type;

				frappe.db.insert(payload).then(function() {
					frappe.show_alert({ message: 'Follow-up added', indicator: 'green' });
					allow_close = true;
					d.hide();
					me.render(me.party_type, me.party_name);
				}).catch(function() {
					d.enable_primary_action();
					frappe.show_alert({ message: 'Could not add follow-up', indicator: 'red' });
				});
			}
		});

		d.show();

		// When compulsory, the only way out is submitting the follow-up:
		// remove the close (X) and block Esc / backdrop-click dismissal.
		if (mandatory) {
			d.$wrapper.find('.modal-header .btn-modal-close').hide();
			d.$wrapper.on('hide.bs.modal', function(e) {
				if (!allow_close) {
					e.preventDefault();
					frappe.show_alert({
						message: 'Please capture the next step before closing.',
						indicator: 'orange'
					});
				}
			});
		}
	}

	// -------------------------------------------------------------------------
	// Edit — owner only (button is only rendered for the task owner; ToDo write
	// permissions still apply server-side).
	// -------------------------------------------------------------------------

	open_edit_task_dialog(todo_name) {
		var me = this;

		frappe.db.get_doc('ToDo', todo_name).then(function(doc) {
			var plain = doc.description
				? $('<div>').html(doc.description).text().trim()
				: '';

			var d = new frappe.ui.Dialog({
				title: 'Edit Activity / Task',
				fields: [
					{ fieldname: 'description', fieldtype: 'Small Text', label: 'Description',
					  reqd: 1, default: plain },
					{ fieldname: 'date',        fieldtype: 'Date',       label: 'Next Task Due Date',
					  default: doc.date || null, reqd: me.due_required() ? 1 : 0 },
					{ fieldname: 'task_type',   fieldtype: 'Link',       label: 'Task Type',
					  options: 'Task Type', default: doc.task_type || null },
					{ fieldname: 'priority',    fieldtype: 'Select',     label: 'Priority',
					  options: 'Low\nMedium\nHigh', default: doc.priority || 'Medium' },
					{ fieldname: 'allocated_to', fieldtype: 'Link',      label: 'Assign To',
					  options: 'User', default: doc.allocated_to || frappe.session.user },
					{ fieldname: 'status',      fieldtype: 'Select',     label: 'Status',
					  options: 'Open\nClosed\nCancelled', default: doc.status || 'Open' }
				],
				primary_action_label: 'Save',
				primary_action: function(values) {
					d.disable_primary_action();

					frappe.db.set_value('ToDo', todo_name, {
						description: values.description,
						date: values.date || null,
						task_type: values.task_type || null,
						priority: values.priority,
						allocated_to: values.allocated_to || frappe.session.user,
						status: values.status || 'Open'
					}).then(function() {
						frappe.show_alert({ message: 'Task updated', indicator: 'green' });
						d.hide();
						me.render(me.party_type, me.party_name);
					}).catch(function() {
						d.enable_primary_action();
						frappe.show_alert({ message: 'Could not update task', indicator: 'red' });
					});
				}
			});

			d.show();
		}).catch(function() {
			frappe.show_alert({ message: 'Could not load task', indicator: 'red' });
		});
	}

	// -------------------------------------------------------------------------
	// Empty state
	// -------------------------------------------------------------------------

	show_empty_state() {
		this.$main.html(
			'<div class="text-muted text-center" style="padding:60px;">'
			+ '<div style="font-size:48px;margin-bottom:16px;">&#128203;</div>'
			+ '<p>No party selected.</p>'
			+ '<p>Open from <a href="/app/my-activities">My Activities</a> — click the Lead or Customer pill on any task row.</p>'
			+ '</div>'
		);
		this.page.set_title('Party Activity Hub');
	}
}
