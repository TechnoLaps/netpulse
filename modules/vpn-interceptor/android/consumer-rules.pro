# The tun2socks engine registers its natives to this exact class via JNI
# (RegisterNatives + FindClass), so R8 must neither rename nor strip it.
-keep class hev.htproxy.TProxyService { *; }
