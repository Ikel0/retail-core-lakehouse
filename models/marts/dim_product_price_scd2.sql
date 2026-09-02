select
    product_id,
    price,
    valid_from,
    valid_to,
    is_current
from {{ ref('stg_price_history') }}
