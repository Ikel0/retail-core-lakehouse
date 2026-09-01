{{ config(unique_key='order_id', incremental_strategy='merge') }}

select
    order_id,
    customer_id,
    product_id,
    channel,
    quantity,
    unit_price,
    discount_rate,
    sales_amount,
    ordered_at,
    current_timestamp as transformed_at
from {{ ref('stg_orders') }}
{% if is_incremental() %}
where ordered_at > (select coalesce(max(ordered_at), '1900-01-01') from {{ this }})
{% endif %}
