select
    s.order_id,
    s.sales_amount,
    p.amount as payment_amount,
    round(s.sales_amount - coalesce(p.amount, 0), 2) as amount_delta,
    case
        when p.order_id is null then 'missing_payment'
        when abs(s.sales_amount - p.amount) > 0.005 then 'amount_mismatch'
        when p.status != 'settled' then 'not_settled'
        else 'reconciled'
    end as reconciliation_status
from {{ ref('fct_sales') }} s
left join {{ ref('fct_payments') }} p using (order_id)
