select *
from {{ ref('fct_payment_reconciliation') }}
where reconciliation_status != 'reconciled'
   or abs(amount_delta) > 0.005
