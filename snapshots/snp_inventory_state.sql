{% snapshot snp_inventory_state %}

{{
    config(
      target_schema='history',
      unique_key='product_id',
      strategy='check',
      check_cols=['store_stock', 'warehouse_stock', 'reserved', 'incoming', 'safety_stock'],
      invalidate_hard_deletes=True
    )
}}

select
    product_id,
    store_stock,
    warehouse_stock,
    reserved,
    incoming,
    safety_stock
from {{ ref('stg_inventory') }}

{% endsnapshot %}
