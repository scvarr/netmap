from sqlalchemy import inspect

from app.database import engine


def test_map_location_state_forward_schema_has_no_geometry_or_membership():
    schema = inspect(engine)
    columns = {column['name'] for column in schema.get_columns('map_location_states')}
    assert columns == {'id', 'variant_id', 'location_id', 'collapsed', 'visible_direct_elements'}
    foreign_keys = {tuple(key['constrained_columns']): key['options'].get('ondelete') for key in schema.get_foreign_keys('map_location_states')}
    assert foreign_keys == {('variant_id',): 'CASCADE', ('location_id',): 'CASCADE'}
