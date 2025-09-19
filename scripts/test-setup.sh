#!/bin/bash

# Test setup script for AutoGen workspace infrastructure
set -e

echo "🚀 AutoGen Workspace Test Setup"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
check_docker() {
    print_status "Checking Docker..."
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    print_success "Docker is running"
}

# Check if Docker Compose is available
check_docker_compose() {
    print_status "Checking Docker Compose..."
    if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
        print_error "Docker Compose is not available. Please install Docker Compose."
        exit 1
    fi
    print_success "Docker Compose is available"
}

# Function to get the compose command
get_compose_cmd() {
    if command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        echo "docker compose"
    fi
}

# Setup function
setup_infrastructure() {
    local mode=$1
    local compose_cmd=$(get_compose_cmd)

    case $mode in
        "dev")
            print_status "Setting up development infrastructure..."
            $compose_cmd --profile dev up -d
            ;;
        "test")
            print_status "Setting up test infrastructure..."
            $compose_cmd --profile test up -d
            ;;
        "minimal")
            print_status "Setting up minimal infrastructure (Redis + Kafka only)..."
            $compose_cmd up -d redis kafka
            ;;
        *)
            print_error "Unknown mode: $mode"
            echo "Available modes: dev, test, minimal"
            exit 1
            ;;
    esac
}

# Wait for services to be healthy
wait_for_services() {
    local mode=$1
    local compose_cmd=$(get_compose_cmd)

    print_status "Waiting for services to be healthy..."

    case $mode in
        "dev")
            services=("redis" "kafka")
            ;;
        "test")
            services=("redis-test" "kafka-test")
            ;;
        "minimal")
            services=("redis" "kafka")
            ;;
    esac

    for service in "${services[@]}"; do
        print_status "Waiting for $service..."

        # Wait up to 120 seconds for service to be healthy
        timeout=120
        elapsed=0
        while [ $elapsed -lt $timeout ]; do
            if $compose_cmd ps $service | grep -q "healthy\|Up"; then
                print_success "$service is ready"
                break
            fi

            if [ $elapsed -ge $timeout ]; then
                print_error "$service failed to become healthy within ${timeout}s"
                $compose_cmd logs $service
                exit 1
            fi

            sleep 2
            elapsed=$((elapsed + 2))
        done
    done
}

# Test connectivity
test_connectivity() {
    local mode=$1

    print_status "Testing connectivity..."

    case $mode in
        "dev"|"minimal")
            redis_port=6379
            kafka_port=9092
            ;;
        "test")
            redis_port=6380
            kafka_port=9093
            ;;
    esac

    # Test Redis
    if command -v redis-cli >/dev/null 2>&1; then
        if redis-cli -p $redis_port ping >/dev/null 2>&1; then
            print_success "Redis connectivity test passed"
        else
            print_warning "Redis connectivity test failed (redis-cli not responding)"
        fi
    else
        print_warning "redis-cli not found, skipping Redis connectivity test"
    fi

    # Test Kafka (basic port check)
    if command -v nc >/dev/null 2>&1; then
        if nc -z localhost $kafka_port; then
            print_success "Kafka connectivity test passed"
        else
            print_warning "Kafka connectivity test failed (port $kafka_port not accessible)"
        fi
    else
        print_warning "netcat not found, skipping Kafka connectivity test"
    fi
}

# Cleanup function
cleanup_infrastructure() {
    local mode=$1
    local compose_cmd=$(get_compose_cmd)

    print_status "Cleaning up infrastructure..."

    case $mode in
        "dev")
            $compose_cmd --profile dev down -v
            ;;
        "test")
            $compose_cmd --profile test down -v
            ;;
        "minimal")
            $compose_cmd down -v
            ;;
        "all")
            $compose_cmd --profile dev --profile test down -v
            ;;
        *)
            print_error "Unknown cleanup mode: $mode"
            echo "Available modes: dev, test, minimal, all"
            exit 1
            ;;
    esac

    print_success "Infrastructure cleaned up"
}

# Status function
show_status() {
    local compose_cmd=$(get_compose_cmd)

    print_status "Infrastructure Status:"
    echo ""
    $compose_cmd ps
    echo ""

    print_status "Network Status:"
    docker network ls | grep autogen || echo "No AutoGen networks found"
    echo ""

    print_status "Volume Status:"
    docker volume ls | grep autogen || echo "No AutoGen volumes found"
}

# Logs function
show_logs() {
    local service=$1
    local compose_cmd=$(get_compose_cmd)

    if [ -z "$service" ]; then
        print_status "Showing logs for all services..."
        $compose_cmd logs -f
    else
        print_status "Showing logs for $service..."
        $compose_cmd logs -f $service
    fi
}

# Run tests function
run_tests() {
    local test_type=$1

    print_status "Running tests..."

    # Ensure test infrastructure is running
    setup_infrastructure "test"
    wait_for_services "test"

    # Set test environment variables
    export REDIS_HOST=localhost
    export REDIS_PORT=6380
    export KAFKA_BROKERS=localhost:9093
    export NODE_ENV=test

    case $test_type in
        "unit")
            print_status "Running unit tests..."
            npm run test -- --testPathIgnorePatterns=integration
            ;;
        "integration")
            print_status "Running integration tests..."
            npm run test:integration
            ;;
        "all")
            print_status "Running all tests..."
            npm run test
            ;;
        *)
            print_error "Unknown test type: $test_type"
            echo "Available types: unit, integration, all"
            exit 1
            ;;
    esac

    test_exit_code=$?

    # Cleanup test infrastructure
    cleanup_infrastructure "test"

    if [ $test_exit_code -eq 0 ]; then
        print_success "Tests completed successfully"
    else
        print_error "Tests failed"
        exit $test_exit_code
    fi
}

# Help function
show_help() {
    echo "AutoGen Workspace Test Setup Script"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  setup [MODE]     Setup infrastructure (modes: dev, test, minimal)"
    echo "  cleanup [MODE]   Cleanup infrastructure (modes: dev, test, minimal, all)"
    echo "  status          Show infrastructure status"
    echo "  logs [SERVICE]  Show logs (optional service name)"
    echo "  test [TYPE]     Run tests (types: unit, integration, all)"
    echo "  help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 setup dev              # Setup development environment with UI tools"
    echo "  $0 setup minimal          # Setup minimal Redis + Kafka"
    echo "  $0 test integration       # Run integration tests"
    echo "  $0 logs kafka             # Show Kafka logs"
    echo "  $0 cleanup all            # Clean up everything"
    echo ""
    echo "Development URLs (when using 'dev' mode):"
    echo "  Kafka UI:        http://localhost:8080"
    echo "  Redis Commander: http://localhost:8081"
}

# Main script logic
main() {
    local command=$1
    local option=$2

    # Check prerequisites
    check_docker
    check_docker_compose

    case $command in
        "setup")
            setup_infrastructure ${option:-"minimal"}
            wait_for_services ${option:-"minimal"}
            test_connectivity ${option:-"minimal"}
            print_success "Infrastructure setup complete!"
            ;;
        "cleanup")
            cleanup_infrastructure ${option:-"minimal"}
            ;;
        "status")
            show_status
            ;;
        "logs")
            show_logs $option
            ;;
        "test")
            run_tests ${option:-"all"}
            ;;
        "help"|"--help"|"-h")
            show_help
            ;;
        "")
            print_error "No command specified"
            show_help
            exit 1
            ;;
        *)
            print_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"