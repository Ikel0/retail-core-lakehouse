with batch as (
    select order_id, quantity from {{ ref('fct_sales') }}
), stream as (
    select order_id, quantity
    from {{ ref('fct_retail_event') }}
    where event_type = 'purchase'
)
select
    coalesce(b.order_id, s.order_id) as order_id,
    b.quantity as batch_quantity,
    s.quantity as stream_quantity
from batch b
full outer join stream s using (order_id)
where b.order_id is null
   or s.order_id is null
   or b.quantity != s.quantity
