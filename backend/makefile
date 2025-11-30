up:
	docker compose up -d --build

mig:
	docker compose exec api python -m alembic upgrade head

logs:
	docker compose logs -f api

down:
	docker compose down

seed:
	python seeding/seed_admin.py