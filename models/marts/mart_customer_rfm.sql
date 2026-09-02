with customer_metrics as (
    select
        c.customer_id,
        max(cast(s.ordered_at as date)) as last_order_date,
        count(distinct s.order_id) as frequency,
        round(sum(s.sales_amount), 2) as monetary,
        count(distinct s.channel) as active_channels
    from {{ ref('dim_customer') }} c
    inner join {{ ref('fct_sales') }} s using (customer_id)
    group by c.customer_id
), anchor as (
    select max(last_order_date) as anchor_date from customer_metrics
), scored as (
    select
        m.*,
        cast(a.anchor_date - m.last_order_date as integer) as recency_days,
        ntile(4) over (order by m.last_order_date) as recency_score,
        ntile(4) over (order by m.frequency) as frequency_score,
        ntile(4) over (order by m.monetary) as monetary_score
    from customer_metrics m
    cross join anchor a
)
select
    *,
    case
      when recency_score + frequency_score + monetary_score >= 10 then 'champions'
      when recency_score + frequency_score + monetary_score >= 8 then 'loyal'
      when recency_score >= 3 and frequency_score <= 2 then 'promising'
      when recency_score <= 2 and monetary_score >= 3 then 'at_risk'
      else 'developing'
    end as rfm_segment
from scored
