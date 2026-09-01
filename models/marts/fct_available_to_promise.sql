with sold as (
    select product_id, sum(quantity) as units_sold
    from {{ ref('fct_sales') }}
    group by product_id
), inventory as (
    select * from {{ source('raw_retail', 'inventory') }}
)
select
    i.product_id,
    i.store_stock,
    i.warehouse_stock,
    i.incoming,
    i.reserved,
    coalesce(s.units_sold, 0) as units_sold,
    i.store_stock + i.warehouse_stock + i.incoming
      - i.reserved - coalesce(s.units_sold, 0) as available_to_promise,
    case
      when available_to_promise < i.safety_stock then 'critical'
      when available_to_promise < i.safety_stock * 2 then 'watch'
      else 'healthy'
    end as risk_level
from inventory i
left join sold s using (product_id)
