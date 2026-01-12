DOCKER_IMAGE = ff_imp:latest

init:
	@if [ ! -d "./israeli-bank-scrapers" ]; then \
		echo "Cloning israeli-bank-scrapers..."; \
		git clone https://github.com/eshaham/israeli-bank-scrapers.git ./israeli-bank-scrapers; \
	else \
		echo "israeli-bank-scrapers already exists"; \
	fi

patch-generate:
	@cd ./israeli-bank-scrapers && git diff > ../scrapper-patches/patch-$$(date +%Y%m%d%H%M%S).patch && cd ..

patch-scrapers:
	@if [ -d "./scrapper-patches" ]; then \
		cd ./israeli-bank-scrapers && git checkout . && git pull && cd ..; \
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

build-npm: 
	@echo "building israeli-bank-scrapers"
	# first install and build israeli-bank-scrapers
	cd ./israeli-bank-scrapers && npm i && npm run build && cd ..
	# then install and build this project
	npm install
	npm run build

remove-dev-deps:
	@echo "removing dev dependencies"
	# first remove dev dependencies from israeli-bank-scrapers
	cd ./israeli-bank-scrapers && npm prune --omit=dev && cd ..
	# then remove dev dependencies from this project
	npm prune --omit=dev

docker-create:	
	@echo  "creating docker..."
	docker build -t $(DOCKER_IMAGE) --no-cache .

docker-run:
	@echo "running docker"
	docker run --rm -it $(DOCKER_IMAGE)
