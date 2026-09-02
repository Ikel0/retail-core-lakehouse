select
    cast(product_id as varchar) as product_id,
    cast(store_stock as integer) as store_stock,
    cast(warehouse_stock as integer) as warehouse_stock,
    cast(reserved as integer) as reserved,
    cast(incoming as integer) as incoming,
    cast(safety_stock as integer) as safety_stock
from {{ source('raw_retail', 'inventory') }}
