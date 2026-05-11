app_name = "nest_crm_tasks"
app_title = "Nest CRM Tasks"
app_publisher = "NestERP"
app_description = "Lead Activity Hub - custom CRM task management for NestERP clients"
app_email = "info@nesterp.com"
app_license = "MIT"

# Fixtures - these are exported/imported with bench migrate
# The client script fixture intercepts ToDo list row clicks for Lead records
fixtures = [
    {
        "dt": "Client Script",
        "filters": [["name", "like", "nest-crm%"]]
    }
]

# App includes - loaded on every desk page
app_include_js = []
app_include_css = []

# Web includes
web_include_js = []
web_include_css = []
