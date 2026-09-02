select product_id
from {{ ref('dim_product_price_scd2') }}
group by product_id
having sum(case when is_current then 1 else 0 end) != 1
