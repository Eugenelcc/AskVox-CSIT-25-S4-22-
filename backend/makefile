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

start:
	python -m uvicorn app.main:app --reload --port 8000


migrate:
	alembic upgrade head


#Commit alembic changes
#make dbcommit m='Random message'
dbcommit:
	alembic revision --autogenerate -m $(m)


migrate-down:
	alembic downgrade -1