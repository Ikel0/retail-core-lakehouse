select
    cast(transaction_id as varchar) as transaction_id,
    cast(order_id as varchar) as order_id,
    cast(amount as decimal(12, 2)) as amount,
    cast(currency as varchar) as currency,
    lower(cast(status as varchar)) as status,
    lower(cast(payment_method as varchar)) as payment_method,
    cast(paid_at as timestamp) as paid_at
from {{ source('raw_retail', 'payments') }}
qualify row_number() over (
    partition by transaction_id order by paid_at desc
) = 1
