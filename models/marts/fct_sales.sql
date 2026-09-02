{{ config(materialized='incremental', unique_key='order_id', incremental_strategy='merge', on_schema_change='fail') }}

select
    o.order_id,
    i.customer_id,
    o.source_customer_id,
    o.product_id,
    o.channel,
    o.store_id,
    o.quantity,
    o.unit_price,
    o.discount_rate,
    o.sales_amount,
    o.ordered_at,
    current_timestamp as transformed_at
from {{ ref('stg_orders') }} o
inner join {{ ref('int_customer_identity_resolution') }} i
    on o.source_customer_id = i.source_customer_id
{% if is_incremental() %}
where o.ordered_at > (
    select coalesce(max(ordered_at), timestamp '1900-01-01') from {{ this }}
)
{% endif %}
