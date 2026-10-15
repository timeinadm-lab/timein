select c.name, e.full_name, l.service_type, l.work_schedule_type, l.days_off
from employee_client_links l
join clients c on c.id = l.client_id
join employees e on e.id = l.employee_id
where c.name ilike '%GSH%' and l.status = 'active' and l.service_type <> 'Consultoria'
order by e.full_name;

update employee_client_links l
set work_schedule_type = 'cliente', days_off = null, schedule_anchor_date = null
from clients c
where c.id = l.client_id and c.name ilike '%GSH%' and l.status = 'active' and l.service_type <> 'Consultoria';
