with demand as (
    select
        product_id,
        sum(quantity) as units_sold,
        round(avg(discount_rate), 4) as average_discount_rate,
        round(sum(sales_amount) / nullif(sum(quantity), 0), 2) as realized_unit_price
    from {{ ref('fct_sales') }}
    group by product_id
), signals as (
    select
        p.product_id,
        p.product_name,
        p.category,
        p.current_price,
        a.available_to_promise,
        a.risk_level,
        d.units_sold,
        d.average_discount_rate,
        d.realized_unit_price,
        round(d.units_sold / nullif(avg(d.units_sold) over (), 0), 3) as demand_index,
        round(a.available_to_promise / nullif(d.units_sold, 0), 3) as stock_cover_ratio
    from {{ ref('dim_product') }} p
    inner join {{ ref('fct_available_to_promise') }} a using (product_id)
    inner join demand d using (product_id)
), decisions as (
    select
        *,
        case
          when risk_level = 'critical' and demand_index >= 1.1 then 'protect_margin'
          when risk_level = 'healthy' and stock_cover_ratio >= 2 and demand_index < 0.9 then 'accelerate_sell_through'
          else 'hold'
        end as recommended_action
    from signals
)
select
    *,
    round(
        case recommended_action
          when 'protect_margin' then current_price * 1.03
          when 'accelerate_sell_through' then current_price * 0.95
          else current_price
        end,
        2
    ) as recommended_price,
    case
      when recommended_action = 'protect_margin' then 'Demande élevée et ATP sous tension'
      when recommended_action = 'accelerate_sell_through' then 'Couverture élevée et demande sous la moyenne'
      else 'Équilibre demande-stock, prix maintenu'
    end as recommendation_reason
from decisions
