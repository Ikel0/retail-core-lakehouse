select
    i.source_system,
    i.source_customer_id,
    i.email_hash,
    c.customer_id
from {{ ref('stg_customer_identities') }} i
inner join {{ ref('stg_customers') }} c using (email_hash)
