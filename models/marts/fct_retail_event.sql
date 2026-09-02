{{ config(materialized='incremental', unique_key='event_id', incremental_strategy='merge', on_schema_change='fail') }}

select
    e.event_id,
    e.event_type,
    e.order_id,
    i.customer_id,
    e.source_customer_id,
    e.product_id,
    e.channel,
    e.quantity,
    e.event_at,
    e.latency_ms,
    e.partition_key,
    current_timestamp as transformed_at
from {{ ref('stg_retail_events') }} e
inner join {{ ref('int_customer_identity_resolution') }} i
    on e.source_customer_id = i.source_customer_id
{% if is_incremental() %}
where e.event_at > (
    select coalesce(max(event_at), timestamp '1900-01-01') from {{ this }}
)
{% endif %}
