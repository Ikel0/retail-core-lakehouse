select
    c.customer_id,
    c.email_hash,
    c.loyalty_id,
    c.country,
    c.acquisition_channel,
    c.consent_marketing,
    count(i.source_customer_id) as resolved_identity_count
from {{ ref('stg_customers') }} c
left join {{ ref('int_customer_identity_resolution') }} i using (customer_id)
group by all
