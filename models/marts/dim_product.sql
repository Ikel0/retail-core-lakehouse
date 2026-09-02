select
    product_id,
    product_name,
    category,
    department,
    collection_name,
    current_price,
    currency
from {{ ref('stg_products') }}
