//
//  SwiftNonCopyable.hpp
//  NitroInput
//
//  `SWIFT_NONCOPYABLE` for the engines Swift holds as stored properties.
//  Swift calls a C++ `const` method on a copy of the object when it reads it
//  from a class property: a copy constructor per call, every vector with it,
//  dozens of times a frame. Marked noncopyable, Swift borrows the object in
//  place instead. A class so marked needs its move constructor and
//  destructor defined out of line, in its .cpp, where they are compiled.
//  Nothing for C++ itself, Android or WebAssembly.
//

#pragma once

#if defined(__APPLE__) && __has_include(<swift/bridging>)
#include <swift/bridging>
#endif

#ifndef SWIFT_NONCOPYABLE
#define SWIFT_NONCOPYABLE
#endif
