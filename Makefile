DOCKER_IMAGE = ff_imp:latest

init:
	@if [ ! -d "./israeli-bank-scrapers" ]; then \
		echo "Cloning israeli-bank-scrapers..."; \
		git clone https://github.com/eshaham/israeli-bank-scrapers.git ./israeli-bank-scrapers; \
	else \
		echo "israeli-bank-scrapers already exists"; \
	fi

patch-scrapers:
	@if [ -d "./scrapper-patches" ]; then \
		echo "Applying patches from scrapper-patches..."; \
		for patch in ./scrapper-patches/*.patch; do \
			if [ -f "$$patch" ]; then \
				echo "Applying $$patch..."; \
				cd ./israeli-bank-scrapers && git apply "../$$patch" && cd ..; \
			fi; \
		done; \
	else \
		echo "No scrapper-patches folder found"; \
	fi

build: 
	@echo "building israeli-bank-scrapers"
	@cd ./israeli-bank-scrapers && npm i && npm run build
	@cd ..
	@npm install
	@npm run build

remove-dev-deps:
	@echo "removing dev dependencies"
	@cd ./israeli-bank-scrapers && npm prune --omit=dev
	@cd ..
	@npm prune --omit=dev

docker-create:	
	@echo  "creating docker..."
	@docker build -t $(DOCKER_IMAGE) .

docker-run:
	docker run --rm -it $(DOCKER_IMAGE)
