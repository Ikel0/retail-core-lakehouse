select
    cast(product_id as varchar) as product_id,
    cast(name as varchar) as product_name,
    cast(category as varchar) as category,
    cast(department as varchar) as department,
    cast(collection as varchar) as collection_name,
    cast(price as decimal(12, 2)) as current_price,
    cast(currency as varchar) as currency
from {{ source('raw_retail', 'products') }}
