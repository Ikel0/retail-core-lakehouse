select
    transaction_id,
    order_id,
    amount,
    currency,
    status,
    payment_method,
    paid_at
from {{ ref('stg_payments') }}
