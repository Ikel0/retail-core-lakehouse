select i.source_customer_id
from {{ ref('stg_customer_identities') }} i
left join {{ ref('int_customer_identity_resolution') }} r using (source_customer_id)
where r.customer_id is null
