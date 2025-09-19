#!/bin/bash

# Comprehensive test runner for AutoGen workspace infrastructure
set -e

echo "🧪 AutoGen Workspace Test Runner"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
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

print_section() {
    echo -e "${PURPLE}[SECTION]${NC} $1"
}

# Variables
TEST_TYPE=""
COVERAGE=false
WATCH=false
VERBOSE=false
SETUP_INFRA=true
CLEANUP_AFTER=true
PARALLEL=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--type)
            TEST_TYPE="$2"
            shift 2
            ;;
        -c|--coverage)
            COVERAGE=true
            shift
            ;;
        -w|--watch)
            WATCH=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --no-setup)
            SETUP_INFRA=false
            shift
            ;;
        --no-cleanup)
            CLEANUP_AFTER=false
            shift
            ;;
        -p|--parallel)
            PARALLEL=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Help function
show_help() {
    echo "AutoGen Workspace Test Runner"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -t, --type TYPE      Test type: unit, integration, performance, all (default: all)"
    echo "  -c, --coverage       Generate test coverage report"
    echo "  -w, --watch          Run tests in watch mode"
    echo "  -v, --verbose        Verbose output"
    echo "  -p, --parallel       Run tests in parallel"
    echo "  --no-setup          Skip infrastructure setup"
    echo "  --no-cleanup        Skip infrastructure cleanup"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Test Types:"
    echo "  unit                 Unit tests only (fast, no infrastructure needed)"
    echo "  integration          Integration tests (requires Redis/Kafka)"
    echo "  performance          Performance and load tests"
    echo "  all                  All test types"
    echo ""
    echo "Examples:"
    echo "  $0                           # Run all tests with default settings"
    echo "  $0 -t unit -c               # Run unit tests with coverage"
    echo "  $0 -t integration -v        # Run integration tests with verbose output"
    echo "  $0 -t performance --no-cleanup  # Run performance tests, keep infrastructure"
    echo "  $0 -w -t unit               # Run unit tests in watch mode"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."

    # Check Node.js
    if ! command -v node >/dev/null 2>&1; then
        print_error "Node.js is not installed"
        exit 1
    fi

    # Check npm
    if ! command -v npm >/dev/null 2>&1; then
        print_error "npm is not installed"
        exit 1
    fi

    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Run this script from the project root."
        exit 1
    fi

    # Install dependencies if node_modules doesn't exist
    if [ ! -d "node_modules" ]; then
        print_status "Installing dependencies..."
        npm install
    fi

    print_success "Prerequisites check passed"
}

# Setup infrastructure
setup_infrastructure() {
    if [ "$SETUP_INFRA" = true ]; then
        print_section "Setting up test infrastructure"

        if [ "$TEST_TYPE" = "unit" ]; then
            print_status "Unit tests don't require infrastructure"
        else
            if [ -f "./scripts/test-setup.sh" ]; then
                ./scripts/test-setup.sh setup test
            else
                print_warning "test-setup.sh not found, skipping infrastructure setup"
            fi
        fi
    else
        print_status "Skipping infrastructure setup (--no-setup)"
    fi
}

# Cleanup infrastructure
cleanup_infrastructure() {
    if [ "$CLEANUP_AFTER" = true ] && [ "$TEST_TYPE" != "unit" ]; then
        print_section "Cleaning up test infrastructure"

        if [ -f "./scripts/test-setup.sh" ]; then
            ./scripts/test-setup.sh cleanup test
        else
            print_warning "test-setup.sh not found, skipping infrastructure cleanup"
        fi
    else
        print_status "Skipping infrastructure cleanup"
    fi
}

# Run unit tests
run_unit_tests() {
    print_section "Running Unit Tests"

    local jest_args=""

    if [ "$COVERAGE" = true ]; then
        jest_args="$jest_args --coverage"
    fi

    if [ "$WATCH" = true ]; then
        jest_args="$jest_args --watch"
    fi

    if [ "$VERBOSE" = true ]; then
        jest_args="$jest_args --verbose"
    fi

    if [ "$PARALLEL" = true ]; then
        jest_args="$jest_args --maxWorkers=50%"
    else
        jest_args="$jest_args --runInBand"
    fi

    # Run unit tests (exclude integration and performance)
    npm run test -- $jest_args --testPathIgnorePatterns="integration|performance"
}

# Run integration tests
run_integration_tests() {
    print_section "Running Integration Tests"

    local jest_args=""

    if [ "$COVERAGE" = true ]; then
        jest_args="$jest_args --coverage"
    fi

    if [ "$VERBOSE" = true ]; then
        jest_args="$jest_args --verbose"
    fi

    # Integration tests should run sequentially to avoid conflicts
    jest_args="$jest_args --runInBand"

    # Set environment variables for integration tests
    export REDIS_HOST=localhost
    export REDIS_PORT=6380
    export KAFKA_BROKERS=localhost:9093
    export NODE_ENV=test

    npm run test -- $jest_args --testPathPattern="integration"
}

# Run performance tests
run_performance_tests() {
    print_section "Running Performance Tests"

    local jest_args=""

    if [ "$VERBOSE" = true ]; then
        jest_args="$jest_args --verbose"
    fi

    # Performance tests should run sequentially
    jest_args="$jest_args --runInBand"

    # Set environment variables for performance tests
    export REDIS_HOST=localhost
    export REDIS_PORT=6380
    export KAFKA_BROKERS=localhost:9093
    export NODE_ENV=test

    # Run with longer timeout for performance tests
    npm run test -- $jest_args --testPathPattern="performance" --testTimeout=120000
}

# Run specific test type
run_tests() {
    local test_type=${TEST_TYPE:-"all"}
    local exit_code=0

    case $test_type in
        "unit")
            run_unit_tests
            exit_code=$?
            ;;
        "integration")
            run_integration_tests
            exit_code=$?
            ;;
        "performance")
            run_performance_tests
            exit_code=$?
            ;;
        "all")
            print_status "Running all test types..."

            # Unit tests first (fastest)
            run_unit_tests
            local unit_exit=$?

            if [ $unit_exit -ne 0 ]; then
                print_error "Unit tests failed"
                exit_code=$unit_exit
            else
                # Integration tests
                run_integration_tests
                local integration_exit=$?

                if [ $integration_exit -ne 0 ]; then
                    print_error "Integration tests failed"
                    exit_code=$integration_exit
                else
                    # Performance tests (only if previous tests passed)
                    run_performance_tests
                    local perf_exit=$?

                    if [ $perf_exit -ne 0 ]; then
                        print_error "Performance tests failed"
                        exit_code=$perf_exit
                    fi
                fi
            fi
            ;;
        *)
            print_error "Unknown test type: $test_type"
            show_help
            exit 1
            ;;
    esac

    return $exit_code
}

# Generate test report
generate_report() {
    if [ "$COVERAGE" = true ]; then
        print_section "Test Coverage Report"

        if [ -f "coverage/lcov-report/index.html" ]; then
            print_success "Coverage report generated: coverage/lcov-report/index.html"

            # Try to open in browser on macOS/Linux
            if command -v open >/dev/null 2>&1; then
                open coverage/lcov-report/index.html
            elif command -v xdg-open >/dev/null 2>&1; then
                xdg-open coverage/lcov-report/index.html
            fi
        fi
    fi
}

# Cleanup function (runs on script exit)
cleanup_on_exit() {
    local exit_code=$?

    if [ $exit_code -ne 0 ]; then
        print_error "Tests failed with exit code $exit_code"
    fi

    # Cleanup infrastructure unless --no-cleanup was specified
    cleanup_infrastructure

    exit $exit_code
}

# Main execution
main() {
    # Set up exit trap
    trap cleanup_on_exit EXIT

    print_status "Starting test run with type: ${TEST_TYPE:-all}"

    # Check prerequisites
    check_prerequisites

    # Setup infrastructure if needed
    setup_infrastructure

    # Run tests
    if run_tests; then
        print_success "All tests passed!"

        # Generate reports
        generate_report

        print_success "Test run completed successfully"
    else
        print_error "Test run failed"
        exit 1
    fi
}

# Handle watch mode specially
if [ "$WATCH" = true ] && [ "$TEST_TYPE" != "unit" ]; then
    print_warning "Watch mode only supported for unit tests. Switching to unit test mode."
    TEST_TYPE="unit"
fi

# Run main function
main