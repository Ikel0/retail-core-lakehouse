select
    cast(event_id as varchar) as event_id,
    lower(cast(event_type as varchar)) as event_type,
    nullif(cast(order_id as varchar), '') as order_id,
    cast(source_customer_id as varchar) as source_customer_id,
    cast(product_id as varchar) as product_id,
    lower(cast(channel as varchar)) as channel,
    cast(quantity as integer) as quantity,
    cast(event_at as timestamp) as event_at,
    cast(latency_ms as integer) as latency_ms,
    cast(partition_key as varchar) as partition_key
from {{ source('raw_retail', 'retail_events') }}
qualify row_number() over (
    partition by event_id order by event_at desc
) = 1
