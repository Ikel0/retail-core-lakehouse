select *
from {{ ref('fct_available_to_promise') }}
where available_to_promise < 0
