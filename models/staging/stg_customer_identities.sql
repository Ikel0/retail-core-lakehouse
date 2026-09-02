select
    lower(cast(source_system as varchar)) as source_system,
    cast(source_customer_id as varchar) as source_customer_id,
    cast(email_hash as varchar) as email_hash
from {{ source('raw_retail', 'customer_identities') }}
qualify row_number() over (
    partition by source_customer_id order by source_system
) = 1
