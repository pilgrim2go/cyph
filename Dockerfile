FROM debian/unstable

MAINTAINER Ryan Lester <hacker@linux.com>

LABEL Name="cyph"

RUN apt-get -y --force-yes update
RUN apt-get -y --force-yes install apt-transport-https apt-utils curl lsb-release

RUN dpkg --add-architecture i386
RUN echo "deb https://deb.nodesource.com/node_7.x sid main" >> /etc/apt/sources.list
RUN echo 'deb https://dl.yarnpkg.com/debian/ stable main' >> /etc/apt/sources.list
RUN curl -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
RUN curl -s https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -

RUN apt-get -y --force-yes update
RUN apt-get -y --force-yes upgrade

RUN apt-get -y --force-yes install \
	android-sdk \
	autoconf \
	automake \
	build-essential \
	cmake \
	devscripts \
	expect \
	gcc-6 \
	g++ \
	git \
	gnupg \
	gnupg-agent \
	golang-go \
	haxe \
	inotify-tools \
	lib32ncurses5 \
	lib32z1 \
	libbz2-1.0:i386 \
	libstdc++6:i386 \
	libtool \
	mono-complete \
	nano \
	nodejs \
	openjdk-8-jdk \
	perl \
	pinentry-curses \
	procps \
	python \
	ruby \
	ruby-dev \
	sudo \
	tightvncserver \
	yarn \
	zopfli

RUN apt-get -y --force-yes update
RUN apt-get -y --force-yes upgrade
RUN apt-get -y --force-yes autoremove

RUN gem update
RUN gem install sass

RUN echo '\
	source /home/gibson/emsdk-portable/emsdk_env.sh > /dev/null 2>&1; \
\
	export GIT_EDITOR="vim"; \
\
	export GOPATH="/home/gibson/go"; \
	export CLOUDSDK_PYTHON="python2"; \
	export CLOUD_PATHS="$( \
		echo -n "/google-cloud-sdk/bin:"; \
		echo -n "/google-cloud-sdk/platform/google_appengine:"; \
		echo -n "/google-cloud-sdk/platform/google_appengine/google/appengine/tools"; \
	)"; \
\
	export JAVA_HOME="$(update-alternatives --query javac | sed -n -e "s/Best: *\(.*\)\/bin\/javac/\\1/p")"; \
\
	export PATH="$( \
		echo -n "/opt/local/bin:"; \
		echo -n "/opt/local/sbin:"; \
		echo -n "/usr/local/opt/go/libexec/bin:"; \
		echo -n "${CLOUD_PATHS}:"; \
		echo -n "${GOPATH}/bin:"; \
		echo -n "${PATH}:"; \
		echo -n "/node_modules/.bin"; \
	)"; \
\
	if [ ! -d ~/.gnupg -a -d ~/.gnupg.original ] ; then cp -a ~/.gnupg.original ~/.gnupg ; fi; \
	export GPG_TTY="$(tty)"; \
	eval $(gpg-agent --daemon 2> /dev/null) > /dev/null 2>&1; \
\
	eval $(ssh-agent 2> /dev/null) > /dev/null 2>&1; \
' >> /.bashrc

RUN echo 'gibson ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers
RUN useradd -ms /bin/bash gibson
RUN mkdir -p /home/gibson
RUN cp -f /.bashrc /home/gibson/.bashrc
RUN cp -f /.bashrc /root/.bashrc
RUN chmod 700 /home/gibson/.bashrc
USER gibson
ENV HOME /home/gibson


RUN bash -c ' \
	cd; \
	wget https://s3.amazonaws.com/mozilla-games/emscripten/releases/emsdk-portable.tar.gz; \
	tar xzf emsdk-portable.tar.gz; \
	rm emsdk-portable.tar.gz; \
	cd emsdk-portable; \
	./emsdk update; \
	./emsdk install latest; \
	./emsdk activate latest; \
	./emsdk uninstall $(./emsdk list | grep INSTALLED | grep node | awk "{print \$2}"); \
'

RUN bash -c ' \
	source ~/.bashrc; \
	mkdir -p /home/gibson/emsdk-portable/node/4.1.1_64bit/bin; \
	ln -s /usr/bin/node /home/gibson/emsdk-portable/node/4.1.1_64bit/bin/node; \
'

RUN bash -c ' \
	cd; \
	git clone https://github.com/google/brotli.git; \
	cd brotli; \
	make; \
	sudo mv bin/bro /usr/bin/; \
	cd; \
	rm -rf brotli; \
'

RUN mkdir ~/haxelib
RUN haxelib setup ~/haxelib
RUN haxelib install hxcpp
RUN haxelib install hxcs
RUN haxelib install hxjava
RUN haxelib install hxnodejs

RUN wget "$( \
	curl -sL https://cloud.google.com/appengine/docs/go/download | \
	grep -oP 'https://.*?go_appengine_sdk_linux_amd64.*?\.zip' | \
	head -n1 \
)" -O ~/go_appengine.zip
RUN unzip ~/go_appengine.zip -d ~
RUN rm ~/go_appengine.zip

RUN rm -rf ~/.gnupg


#CIRCLECI:RUN sudo apt-get -y --force-yes update
#CIRCLECI:RUN sudo apt-get -y --force-yes upgrade
#CIRCLECI:RUN mkdir -p ~/getlibs/commands
#CIRCLECI:RUN mkdir -p ~/getlibs/shared/lib/js/module_locks/firebase-server
#CIRCLECI:RUN mkdir -p ~/getlibs/shared/lib/js/module_locks/ts-node
#CIRCLECI:RUN mkdir -p ~/getlibs/shared/lib/js/module_locks/tslint
#CIRCLECI:RUN echo 'GETLIBS_BASE64' | base64 --decode > ~/getlibs/commands/getlibs.sh
#CIRCLECI:RUN echo 'LIBCLONE_BASE64' | base64 --decode > ~/getlibs/commands/libclone.sh
#CIRCLECI:RUN echo 'PACKAGE_BASE64' | base64 --decode > ~/getlibs/shared/lib/js/package.json
#CIRCLECI:RUN touch ~/getlibs/shared/lib/js/yarn.lock
#CIRCLECI:RUN echo 'FBS_BASE64' | base64 --decode > ~/getlibs/shared/lib/js/module_locks/firebase-server/package.json
#CIRCLECI:RUN touch ~/getlibs/shared/lib/js/module_locks/firebase-server/yarn.lock
#CIRCLECI:RUN echo 'TSN_BASE64' | base64 --decode > ~/getlibs/shared/lib/js/module_locks/ts-node/package.json
#CIRCLECI:RUN touch ~/getlibs/shared/lib/js/module_locks/ts-node/yarn.lock
#CIRCLECI:RUN echo 'TSL_BASE64' | base64 --decode > ~/getlibs/shared/lib/js/module_locks/tslint/package.json
#CIRCLECI:RUN touch ~/getlibs/shared/lib/js/module_locks/tslint/yarn.lock
#CIRCLECI:RUN git clone --depth 1 https://github.com/jedisct1/libsodium.js ~/getlibs/shared/lib/js/libsodium
#CIRCLECI:RUN chmod -R 777 ~/getlibs
#CIRCLECI:RUN ~/getlibs/commands/getlibs.sh
#CIRCLECI:RUN sudo mkdir /cyph
#CIRCLECI:RUN sudo chmod 777 /cyph


VOLUME /cyph
VOLUME /home/gibson/.cyph
VOLUME /home/gibson/.gitconfig
VOLUME /home/gibson/.gnupg.original
VOLUME /home/gibson/.ssh

WORKDIR /cyph/commands

EXPOSE 5000 5001 5002 31337 44000


CMD /bin/bash
