with source as (
    select * from {{ source('raw_retail', 'orders') }}
), typed as (
    select
        cast(order_id as varchar) as order_id,
        cast(source_customer_id as varchar) as source_customer_id,
        cast(product_id as varchar) as product_id,
        lower(channel) as channel,
        cast(store_id as varchar) as store_id,
        cast(quantity as integer) as quantity,
        cast(unit_price as decimal(12,2)) as unit_price,
        cast(discount_rate as decimal(5,4)) as discount_rate,
        cast(ordered_at as timestamp) as ordered_at,
        lower(payment_status) as payment_status,
        round(cast(quantity as integer) * cast(unit_price as decimal(12,2)), 2) as sales_amount
    from source
)
select * from typed
qualify row_number() over (partition by order_id order by ordered_at desc) = 1
