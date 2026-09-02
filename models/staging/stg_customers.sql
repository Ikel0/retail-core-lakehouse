select
    cast(customer_id as varchar) as customer_id,
    cast(email_hash as varchar) as email_hash,
    nullif(cast(loyalty_id as varchar), '') as loyalty_id,
    cast(country as varchar) as country,
    cast(acquisition_channel as varchar) as acquisition_channel,
    cast(consent_marketing as boolean) as consent_marketing
from {{ source('raw_retail', 'customers') }}
