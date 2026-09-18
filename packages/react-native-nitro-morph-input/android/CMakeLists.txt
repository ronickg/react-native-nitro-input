project(NitroMorphInput)
cmake_minimum_required(VERSION 3.9.0)

set (PACKAGE_NAME NitroMorphInput)
set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 20)

# Define C++ library and add all sources
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
        src/main/cpp/JMorphEngine.cpp
        src/main/cpp/JAmountFormatter.cpp
        ../cpp/MorphEngine.cpp
        ../cpp/AmountFormatter.cpp
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroMorphInput+autolinking.cmake)

# Set up local includes
include_directories(
        "src/main/cpp"
        "../cpp"
)

find_library(LOG_LIB log)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android                                   # <-- Android core
)
