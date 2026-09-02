select
    cast(product_id as varchar) as product_id,
    cast(price as decimal(12, 2)) as price,
    cast(valid_from as date) as valid_from,
    cast(valid_to as date) as valid_to,
    cast(is_current as boolean) as is_current
from {{ source('raw_retail', 'price_history') }}
