select *
from {{ ref('mart_repricing_candidates') }}
where recommended_price < round(current_price * 0.95, 2)
   or recommended_price > round(current_price * 1.03, 2)
