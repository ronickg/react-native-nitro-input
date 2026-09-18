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
        src/main/cpp/JMorphWorklets.cpp
        ../cpp/MorphEngine.cpp
        ../cpp/AmountFormatter.cpp
        ../cpp/worklets/MorphWorkletsBridge.cpp
        ../cpp/worklets/HybridMorphWorklets.cpp
)

# Add Nitrogen specs :)
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NitroMorphInput+autolinking.cmake)

# Set up local includes
include_directories(
        "src/main/cpp"
        "../cpp"
        "../cpp/worklets"
)

# Worklets are optional: with react-native-worklets installed the views can
# run `transform` / `onChangeText` worklets synchronously on the UI thread.
find_package(react-native-worklets CONFIG QUIET)
if(react-native-worklets_FOUND)
  target_compile_definitions(${PACKAGE_NAME} PRIVATE MORPH_INPUT_WORKLETS=1)
  target_link_libraries(${PACKAGE_NAME} react-native-worklets::worklets)
  message(STATUS "NitroMorphInput: react-native-worklets found, worklet support enabled")
else()
  message(STATUS "NitroMorphInput: react-native-worklets not found, worklet support disabled")
endif()

find_library(LOG_LIB log)

# Link all libraries together
target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android                                   # <-- Android core
)
